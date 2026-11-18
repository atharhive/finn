import { describe, expect, it, vi } from 'vitest';
import { FinnController, type Backend } from '../../src/extension/controller.js';
import type { AgentRunOptions } from '../../src/contracts.js';

function fixture() {
  let options: AgentRunOptions | undefined;
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const backend = {
    workspace: { listProposals: vi.fn((): import('../../src/extension/controller.js').ReviewProposal[] => []), acceptHunk: vi.fn(async () => {}), rejectHunk: vi.fn(async () => {}), undo: vi.fn(async () => {}), discardPending: vi.fn() },
    assemble: vi.fn(async () => ({ files: [{ path: 'src/main.rs', content: 'fn main() {}', tokens: 5, reasons: ['query match'] }], tokens: 5, budget: 100, strategy: 'rust', warnings: [] })),
    agent: { run: vi.fn(async (run: AgentRunOptions) => { options = run; run.onEvent({type:'text', text:'Working'}); await pending; return {sessionId:'real-session'}; }), cancel: vi.fn(async () => { finish(); }) },
    dispose: vi.fn(async () => {}),
  } satisfies Backend;
  const changed = vi.fn();
  const controller = new FinnController({ ready: true, status: 'Ready', start: async () => backend, changed, preview: vi.fn(async () => {}), settings: vi.fn(async () => {}), contextBudget: 100 });
  return { controller, backend, get options() { return options; }, finish, changed };
}

describe('human review', () => {
  it('validates hunk identity and delegates only explicit human review decisions', async () => {
    const test = fixture();
    const run = test.controller.run('Fix main');
    await vi.waitFor(() => expect(test.backend.agent.run).toHaveBeenCalledOnce());
    await test.controller.handle({ type:'accept', proposalId:'p', hunkId:'h' });
    expect(test.backend.workspace.acceptHunk).not.toHaveBeenCalled();
    test.finish(); await run;
    const proposal = { id:'p', path:'main.rs', original:'old', proposed:'new', status:'pending' as const, hunks:[{ id:'h', diff:'-old\n+new', status:'pending' as const }] };
    test.backend.workspace.listProposals.mockReturnValue([proposal]);
    await test.controller.handle({ type:'accept', proposalId:'p', hunkId:'missing' });
    expect(test.backend.workspace.acceptHunk).not.toHaveBeenCalled();
    await test.controller.handle({ type:'accept', proposalId:'p', hunkId:'h' });
    expect(test.backend.workspace.acceptHunk).toHaveBeenCalledExactlyOnceWith('p','h');
    await test.controller.handle({ type:'reject', proposalId:'p', hunkId:'h' });
    expect(test.backend.workspace.rejectHunk).toHaveBeenCalledExactlyOnceWith('p','h');
    await test.controller.handle({ type:'undo' });
    expect(test.backend.workspace.undo).toHaveBeenCalledOnce();
  });
});

describe('run lifecycle', () => {
  it('shows the actual tool names without exposing raw tool payloads', async () => {
    const test = fixture();
    const running = test.controller.run('Explain');
    await vi.waitFor(() => expect(test.backend.agent.run).toHaveBeenCalled());
    test.options!.onEvent({type:'tool',text:'Tool calls',data:{toolCalls:[{id:'call',name:'editor__read_file',arguments:{token:'not for UI'}}]}});
    expect(test.controller.state.entries.at(-1)?.text).toContain('editor__read_file');
    expect(JSON.stringify(test.controller.state)).not.toContain('not for UI');
    await test.controller.cancel(); await running;
  });

  it('disposes connections and aborts the run without undoing accepted work', async () => {
    const test = fixture();
    const running = test.controller.run('Change code');
    await vi.waitFor(() => expect(test.backend.agent.run).toHaveBeenCalled());
    await test.controller.dispose();
    await running;
    expect(test.options!.signal!.aborted).toBe(true);
    expect(test.backend.dispose).toHaveBeenCalledOnce();
    expect(test.backend.workspace.discardPending).toHaveBeenCalledOnce();
    expect(test.backend.workspace.undo).not.toHaveBeenCalled();
    await test.controller.run('No work after disposal');
    expect(test.backend.agent.run).toHaveBeenCalledOnce();
    await test.controller.dispose();
    expect(test.backend.dispose).toHaveBeenCalledOnce();
  });

  it('closes a backend that completes initialization after cancellation', async () => {
    const test = fixture();
    let resolve!: (backend: Backend) => void;
    const controller = new FinnController({ready:true,status:'Ready',contextBudget:100,start:() => new Promise(done => {resolve = done;}),changed:vi.fn(),preview:vi.fn(),settings:vi.fn()});
    const running = controller.run('Start');
    await controller.cancel();
    resolve(test.backend);
    await running;
    expect(test.backend.dispose).toHaveBeenCalledOnce();
    expect(test.backend.agent.run).not.toHaveBeenCalled();
  });

  it('streams actual events and assembles the actual query while never publishing context contents', async () => {
    const test = fixture();
    const running = test.controller.run('Explain main');
    await vi.waitFor(() => expect(test.backend.agent.run).toHaveBeenCalledOnce());
    expect(test.backend.assemble).toHaveBeenCalledWith(expect.objectContaining({query:'Explain main', maxTokens:100}));
    expect(test.controller.state.entries.some(entry => entry.text === 'Working')).toBe(true);
    expect(JSON.stringify(test.controller.state.context)).not.toContain('fn main()');
    expect(test.options!.prompt).toContain('fn main()');
    expect(test.controller.state.busy).toBe(true);
    test.finish(); await running;
    expect(test.controller.state.busy).toBe(false);
  });

  it('aborts immediately, discards pending proposals, and ignores late events without undoing accepted changes', async () => {
    const test = fixture();
    const running = test.controller.run('Change main');
    await vi.waitFor(() => expect(test.backend.agent.run).toHaveBeenCalledOnce());
    await test.controller.cancel();
    expect(test.options!.signal!.aborted).toBe(true);
    expect(test.backend.workspace.discardPending).toHaveBeenCalledOnce();
    expect(test.backend.workspace.undo).not.toHaveBeenCalled();
    const entries = test.controller.state.entries.length;
    test.options!.onEvent({ type:'text', text:'late untrusted response' });
    expect(test.controller.state.entries).toHaveLength(entries);
    await running;
    expect(test.controller.state.status).toBe('Stopped. Pending changes discarded.');
    expect(test.controller.state.busy).toBe(false);
  });
});
