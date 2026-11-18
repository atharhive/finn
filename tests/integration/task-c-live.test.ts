import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FinnAgent } from '../../src/agent/index.js';
import { createWorkspace } from '../../src/workspace/index.js';
import type { AgentEvent } from '../../src/contracts.js';

const root = process.env.FINN_FLASK_CLEAN_ROOT;

it.runIf(Boolean(root && process.env.FINN_TRUEFORGE_LIVE_URL && process.env.FINN_TEST_FAILURE_MODEL))('real Task C leaves the workspace unchanged when the model is unreachable', async () => {
  const helpers = join(root!, 'src/flask/helpers.py');
  const before = await readFile(helpers, 'utf8');
  const start = before.indexOf('def get_debug_flag()');
  const end = before.indexOf('\n\ndef get_load_dotenv', start);
  const workspace = await createWorkspace({ root: root!, approveCommand: async () => false });
  const mcp = await workspace.startMcpServer();
  const agent = new FinnAgent({
    baseUrl: process.env.FINN_TRUEFORGE_LIVE_URL!,
    model: process.env.FINN_TEST_FAILURE_MODEL!,
    mcpUrl: mcp.url,
    mcpToken: mcp.token,
    workspaceRoot: root!,
    requestTimeoutMs: 30000,
    maxRetries: 0,
  });
  const events: AgentEvent[] = [];
  try {
    await expect(agent.run({
      prompt: "Treat the values 'off' and 'n' as false as well, case-insensitively, and update the docstring to list every value that is treated as false.",
      mode: 'inline',
      selection: { path: 'src/flask/helpers.py', startLine: 28, endLine: 33, text: before.slice(start, end) },
      onEvent: event => events.push(event),
    })).rejects.toThrow();
    expect(events.some(event => event.type === 'error' && Boolean(event.text))).toBe(true);
    expect(workspace.listProposals()).toEqual([]);
    expect(await readFile(helpers, 'utf8')).toBe(before);
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
    expect(status.stdout.trim()).toBe('');
  } finally {
    await agent.dispose();
    await workspace.dispose();
  }
}, 45000);
