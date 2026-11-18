import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { FinnAgent } from '../../src/agent/index.js';
import { createWorkspace } from '../../src/workspace/index.js';
import type { AgentEvent } from '../../src/contracts.js';

// Opt-in: the named model must be configured in the real local TrueForge with
// an unreachable endpoint. This is failure verification, not an inference demo.
it.runIf(Boolean(process.env.FINN_TRUEFORGE_LIVE_URL && process.env.FINN_TEST_FAILURE_MODEL))('a real unreachable provider reports failure without changing source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'finn-real-provider-failure-'));
  const source = 'export const enabled = true;\n';
  await writeFile(join(root, 'example.ts'), source);
  const workspace = await createWorkspace({ root, approveCommand: async () => false });
  const mcp = await workspace.startMcpServer();
  const agent = new FinnAgent({
    baseUrl: process.env.FINN_TRUEFORGE_LIVE_URL!, model: process.env.FINN_TEST_FAILURE_MODEL!,
    mcpUrl: mcp.url, mcpToken: mcp.token, workspaceRoot: root,
    maxRetries: 0, requestTimeoutMs: 30000,
  });
  const events: AgentEvent[] = [];
  try {
    await expect(agent.run({ prompt: 'Change the selected constant to false.', mode: 'inline', selection: { path: 'example.ts', startLine: 1, endLine: 1, text: source }, onEvent: event => events.push(event) })).rejects.toThrow();
    expect(events.some(event => event.type === 'session')).toBe(true);
    expect(events.some(event => event.type === 'error' && Boolean(event.text))).toBe(true);
    expect(events.some(event => event.type === 'done')).toBe(false);
    expect(await readFile(join(root, 'example.ts'), 'utf8')).toBe(source);
    expect(workspace.listProposals()).toEqual([]);
    console.log('Real unreachable-provider failure verified:', events.filter(event => event.type === 'error').map(event => event.text).join('; '));
  } finally {
    await agent.dispose();
    await workspace.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 45000);
