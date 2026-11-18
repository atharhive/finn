import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { request as httpRequest } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createWorkspace, type WorkspaceService } from '../../src/workspace/index.js';
let root: string; let service: WorkspaceService; const clients: Client[] = [];
beforeEach(async () => { root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'finn-mcp-')); });
afterEach(async () => { await Promise.all(clients.splice(0).map(c => c.close())); await service?.dispose(); await rm(root, { force: true, recursive: true }); });

it('exercises real SDK initialization, session isolation and every tool without automatic writes', async () => {
  let contextRequest: unknown;
  service = await createWorkspace({ root, approveCommand: async () => true, contextProvider: async request => {
    contextRequest = request; return { files: [], tokens: 0, budget: request.maxTokens, strategy: 'test', warnings: [] };
  } });
  await writeFile(join(root, 'a.txt'), 'before\n');
  const { url, token } = await service.startMcpServer();
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  const client = new Client({ name: 'workspace-integration', version: '1' }); clients.push(client);
  await client.connect(transport);
  expect(transport.sessionId).toBeTruthy();
  expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(['assemble_context', 'propose_edit', 'read_file', 'run_command', 'search_workspace']);
  const read = await client.callTool({ name: 'read_file', arguments: { path: 'a.txt' } });
  expect(JSON.stringify(read)).toContain('before');
  expect(JSON.stringify(await client.callTool({ name: 'search_workspace', arguments: { query: 'before' } }))).toContain('a.txt');
  const proposed = await client.callTool({ name: 'propose_edit', arguments: { path: 'a.txt', content: 'after\n' } });
  expect(proposed.isError).not.toBe(true);
  expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('before\n');
  expect(service.listProposals()).toHaveLength(1);
  const command = await client.callTool({ name: 'run_command', arguments: { command: process.execPath, args: ['-e', 'console.log("real")'] } });
  expect(JSON.stringify(command)).toContain('real');
  const context = await client.callTool({ name: 'assemble_context', arguments: { query: 'actual question', maxTokens: 1234, mentions: ['a.txt'] } });
  expect(context.isError).not.toBe(true);
  expect(contextRequest).toMatchObject({ query: 'actual question', maxTokens: 1234, mentions: ['a.txt'] });
  const badSession = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'mcp-session-id': 'unknown' }, body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'tools/list' }) });
  expect(badSession.status).toBe(404);
  await transport.terminateSession();
});

it('cancels a real MCP tool request and kills the approved process tree', async () => {
  let approved!: () => void; const approval = new Promise<void>(resolve => { approved = resolve; });
  service = await createWorkspace({ root, approveCommand: async () => { approved(); return true; } });
  const { url, token } = await service.startMcpServer();
  const client = new Client({ name: 'cancel-test', version: '1' }); clients.push(client);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const marker = join(root, 'must-not-exist');
  const childCode = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'leaked'), 600)`;
  const parentCode = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], {stdio:'ignore'}); setInterval(() => {}, 1000)`;
  const controller = new AbortController();
  const running = client.callTool({ name: 'run_command', arguments: { command: process.execPath, args: ['-e', parentCode] } }, undefined, { signal: controller.signal });
  const rejected = expect(running).rejects.toThrow();
  await approval; await new Promise(resolve => setTimeout(resolve, 150)); controller.abort();
  await rejected; await new Promise(resolve => setTimeout(resolve, 800));
  await expect(readFile(marker)).rejects.toThrow();
});

it('rejects unauthorized, hostile origins/hosts and oversized requests before dispatch', async () => {
  service = await createWorkspace({ root }); const { url, token } = await service.startMcpServer();
  expect(new URL(url).hostname).toBe('127.0.0.1');
  expect((await fetch(url, { method: 'POST' })).status).toBe(401);
  expect((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
  expect((await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://attacker.example' }, body: '{}' })).status).toBe(403);
  const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(url, { method: 'POST', headers: { ...headers, Host: 'attacker.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end('{}');
  });
  expect(hostileHostStatus).toBe(403);
  expect((await fetch(url, { method: 'POST', headers, body: 'x'.repeat(2 * 1024 * 1024 + 1) })).status).toBe(413);
  expect((await fetch(url, { method: 'POST', headers, body: '{' })).status).toBe(400);
});
