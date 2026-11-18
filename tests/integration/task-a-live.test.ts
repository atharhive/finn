import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FinnAgent } from '../../src/agent/index.js';
import { createWorkspace } from '../../src/workspace/index.js';
import { createContextProvider } from '../../src/context/index.js';
import type { AgentEvent } from '../../src/contracts.js';

const root = process.env.FINN_FLASK_ROOT;
const python = process.env.FINN_FLASK_PYTHON;
const instruction = "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.";

it.runIf(Boolean(root && python && process.env.FINN_TRUEFORGE_LIVE_URL && process.env.FINN_LIVE_MODEL))('real Task A proposes an inline Flask debug-flag change', async () => {
  const helpers = join(root!, 'src/flask/helpers.py');
  const source = await readFile(helpers, 'utf8');
  const start = source.indexOf('def get_debug_flag()');
  const end = source.indexOf('\n\ndef get_load_dotenv', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const selection = source.slice(start, end);
  const context = await createContextProvider({ root: root!, binaryPath: join(process.cwd(), 'target/debug/finn_mcp') });
  const workspace = await createWorkspace({
    root: root!,
    approveCommand: async () => false,
    contextProvider: request => context.assemble(request),
  });
  const mcp = await workspace.startMcpServer();
  const agent = new FinnAgent({
    baseUrl: process.env.FINN_TRUEFORGE_LIVE_URL!,
    model: process.env.FINN_LIVE_MODEL!,
    mcpUrl: mcp.url,
    mcpToken: mcp.token,
    workspaceRoot: root!,
    requestTimeoutMs: 300000,
    maxRetries: 1,
  });
  const events: AgentEvent[] = [];
  try {
    await agent.run({
      prompt: instruction,
      mode: 'inline',
      selection: { path: 'src/flask/helpers.py', startLine: 28, endLine: 33, text: selection },
      onEvent: event => {
        events.push(event);
        if (event.type !== 'text') console.log(event.type, event.text ?? '');
      },
    });
    const proposals = workspace.listProposals();
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.some(proposal => proposal.path.includes('helpers.py'))).toBe(true);
    expect(events.some(event => event.type === 'session')).toBe(true);
    expect(events.some(event => event.type === 'done')).toBe(true);
    for (const proposal of proposals) {
      for (const hunk of proposal.hunks) {
        if (hunk.status === 'pending') await workspace.acceptHunk(proposal.id, hunk.id);
      }
    }
    const after = spawnSync(python!, ['-c', 'from flask.helpers import get_debug_flag; print(get_debug_flag())'], {
      env: { ...process.env, FLASK_DEBUG: 'off', PYTHONPATH: join(root!, 'src') },
      encoding: 'utf8',
    });
    expect(after.status).toBe(0);
    expect(after.stdout.trim()).toBe('False');
  } finally {
    console.log('Task A events', events.map(event => `${event.type}:${event.text ?? ''}`).join(' | ').slice(0, 4000));
    console.log('Proposals', workspace.listProposals().map(proposal => ({ path: proposal.path, status: proposal.status, hunks: proposal.hunks.length })));
    await agent.dispose();
    await workspace.dispose();
    await context.dispose();
  }
}, 330000);
