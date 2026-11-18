import { expect, it } from 'vitest';
import { FinnAgent } from '../../src/agent/index.js';
import { createWorkspace } from '../../src/workspace/index.js';
import { createContextProvider } from '../../src/context/index.js';
import { join } from 'node:path';
import type { AgentEvent } from '../../src/contracts.js';

const root = process.env.FINN_FLASK_ROOT;
const instruction = 'Add a new built-in CLI command flask config that prints the loaded application\'s configuration as JSON, masking the values of any key containing SECRET, PASSWORD, TOKEN or KEY as "***". It must appear in flask --help, be covered by a test, and be documented alongside the other built-in commands.';

it.runIf(Boolean(root && process.env.FINN_TRUEFORGE_LIVE_URL && process.env.FINN_LIVE_MODEL))('real Task B proposes an unprompted multi-file Flask config command', async () => {
  const context = await createContextProvider({ root: root!, binaryPath: join(process.cwd(), 'target/debug/finn_mcp') });
  const workspace = await createWorkspace({
    root: root!,
    approveCommand: async request => request.command.includes('python') && request.args.join(' ').includes('pytest tests/test_cli.py'),
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
      mode: 'agent',
      onEvent: event => { events.push(event); if (event.type !== 'text') console.log(event.type, event.text ?? ''); },
    });
    const pending = workspace.listProposals().filter(proposal => proposal.status === 'pending' || proposal.hunks.some(hunk => hunk.status === 'pending'));
    const files = new Set(pending.map(proposal => proposal.path));
    console.log('Task B files', [...files]);
    expect(files.size).toBeGreaterThanOrEqual(3);
    expect(events.some(event => event.type === 'session')).toBe(true);
    expect(events.some(event => event.type === 'done')).toBe(true);
  } finally {
    await agent.dispose();
    await workspace.dispose();
    await context.dispose();
  }
}, 330000);
