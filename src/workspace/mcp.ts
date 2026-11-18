import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { WorkspaceService } from './index.js';

const MAX_BODY = 2 * 1024 * 1024;
export interface McpBridge { url: string; token: string; close(): Promise<void> }

/** One authenticated SDK transport/server pair per MCP session. */
export async function startBridge(workspace: WorkspaceService): Promise<McpBridge> {
  const token = randomBytes(32).toString('hex');
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer }>();
  const instances = new Set<McpServer>();
  let origin = ''; let closed = false;
  const result = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value) }] });
  const makeServer = () => {
    const server = new McpServer({ name: 'finn-workspace', version: '1.0.0' });
    server.registerTool('read_file', { description: 'Read a non-secret UTF-8 file inside the workspace. No writes.', inputSchema: { path: z.string().min(1) } }, async ({ path }) => result(await workspace.readFile(path)));
    server.registerTool('search_workspace', { description: 'Literal bounded search of non-secret workspace text. No writes.', inputSchema: { query: z.string().min(1).max(1024) } }, async ({ query }) => result(await workspace.searchWorkspace(query)));
    server.registerTool('propose_edit', { description: 'Stage the COMPLETE new file contents for human per-hunk review. Never send a snippet or a single function. This does NOT write files; only a human can accept hunks. Partial replacements that drop most of an existing file are rejected.', inputSchema: { path: z.string().min(1), content: z.string().max(1024 * 1024), originalHash: z.string().optional() } }, async ({ path, content, originalHash }) => result(await workspace.proposeEdit(path, content, originalHash)));
    server.registerTool('run_command', { description: 'Request explicit human approval of a command and its exact arguments. Never executes without approval; bounded time and output.', inputSchema: { command: z.string().min(1), args: z.array(z.string()).max(256), cwd: z.string().optional(), timeoutMs: z.number().int().positive().max(30000).optional() } }, async (request, extra) => result(await workspace.runCommand(request, extra.signal)));
    server.registerTool('assemble_context', { description: 'Assemble actual workspace context with a requested query and token budget; excludes secrets.', inputSchema: { query: z.string().min(1).max(8192), maxTokens: z.number().int().positive().max(32768), mentions: z.array(z.string()).max(128).optional() } }, async (request, extra) => result(await workspace.assembleContext({ ...request, signal: extra.signal })));
    return server;
  };
  const reject = (res: ServerResponse, status: number, message: string) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: message }));
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const supplied = Buffer.from(req.headers.authorization ?? ''); const wanted = Buffer.from(`Bearer ${token}`);
    if (supplied.length !== wanted.length || !timingSafeEqual(supplied, wanted)) { reject(res, 401, 'Unauthorized'); return; }
    if (req.headers.host !== new URL(origin).host || (req.headers.origin !== undefined && req.headers.origin !== origin)) { reject(res, 403, 'Host or Origin forbidden'); return; }
    if (closed) { reject(res, 503, 'Disposed'); return; }
    if (req.url !== '/mcp') { reject(res, 404, 'Not found'); return; }
    if (!['GET', 'POST', 'DELETE'].includes(req.method ?? '')) { reject(res, 405, 'Method not allowed'); return; }
    let body: unknown;
    if (req.method === 'POST') {
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { reject(res, 413, 'Request too large'); req.resume(); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk); size += buffer.length;
        if (size > MAX_BODY) { reject(res, 413, 'Request too large'); req.resume(); return; }
        chunks.push(buffer);
      }
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reject(res, 400, 'Invalid JSON'); return; }
    }
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId !== undefined) {
      const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
      if (!session) { reject(res, 404, 'Unknown MCP session'); return; }
      await session.transport.handleRequest(req, res, body); return;
    }
    if (req.method !== 'POST' || !isInitializeRequest(body)) { reject(res, 400, 'MCP initialization required'); return; }
    if (instances.size >= 16) { reject(res, 429, 'MCP session limit'); return; }
    const server = makeServer(); instances.add(server);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: randomUUID, enableJsonResponse: true,
      onsessioninitialized: id => { sessions.set(id, { transport, server }); },
    });
    await server.connect(transport);
    const previousClose = transport.onclose;
    transport.onclose = () => { if (transport.sessionId) sessions.delete(transport.sessionId); instances.delete(server); previousClose?.(); };
    try { await transport.handleRequest(req, res, body); }
    finally { if (!transport.sessionId) { instances.delete(server); await server.close(); } }
  };
  const http = createServer((req, res) => {
    void handle(req, res).catch(() => { if (!res.headersSent) reject(res, 500, 'MCP request failed'); else res.end(); });
  });
  http.requestTimeout = 35000; http.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { http.once('error', reject); http.listen(0, '127.0.0.1', () => { http.removeListener('error', reject); resolve(); }); });
  const address = http.address();
  if (!address || typeof address === 'string') throw new Error('Missing loopback address');
  origin = `http://127.0.0.1:${address.port}`;
  return {
    url: `${origin}/mcp`, token,
    async close() {
      if (closed) return; closed = true;
      await Promise.all([...instances].map(server => server.close()));
      await new Promise<void>((resolve, reject) => { http.close(error => error ? reject(error) : resolve()); http.closeAllConnections(); });
    },
  };
}
