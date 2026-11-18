import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile, rm, mkdir, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspace, type WorkspaceService } from '../../src/workspace/index.js';

let root: string;
let service: WorkspaceService;
beforeEach(async () => { root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'finn-workspace-')); service = await createWorkspace({ root }); });
afterEach(async () => { await service?.dispose(); await rm(root, { recursive: true, force: true }); });

describe('workspace security', () => {
  it('revalidates paths at acceptance and refuses hardlinked files', async () => {
    await mkdir(join(root, 'dir')); await writeFile(join(root, 'dir/a.txt'), 'old');
    const p = await service.proposeEdit('dir/a.txt', 'new');
    await rm(join(root, 'dir'), { recursive: true }); await symlink(root, join(root, 'dir'));
    await expect(service.acceptHunk(p.id, p.hunks[0]!.id)).rejects.toThrow(/symlink/i);
    await writeFile(join(root, 'original'), 'old'); await link(join(root, 'original'), join(root, 'hardlink'));
    await expect(service.proposeEdit('hardlink', 'changed')).rejects.toThrow(/hardlink/i);
  });
  it('never exposes secret files returned by context callbacks and cancels pending context', async () => {
    await writeFile(join(root, '.env'), 'TOKEN=secret'); await service.dispose();
    service = await createWorkspace({ root, contextProvider: async () => ({ files: [{ path: '.env', content: 'TOKEN=secret', tokens: 4, reasons: ['mention'] }], tokens: 4, budget: 100, strategy: 'test', warnings: [] }) });
    await expect(service.assembleContext({ query: 'secret', maxTokens: 100 })).rejects.toThrow(/forbidden/i);
    await service.dispose();
    service = await createWorkspace({ root, contextProvider: () => new Promise(() => {}) });
    const running = service.assembleContext({ query: 'slow', maxTokens: 100 }); service.discardPending();
    await expect(running).rejects.toThrow(/cancel/i);
  });
  it('denies traversal, symlinks, git and secret paths on read, search and proposals', async () => {
    await mkdir(join(root, '.git')); await writeFile(join(root, '.git/config'), 'secret');
    await writeFile(join(root, '.env.local'), 'secret'); await writeFile(join(root, 'private.pem'), 'secret');
    await writeFile(join(root, 'ok.txt'), 'needle'); await symlink(join(root, 'ok.txt'), join(root, 'link.txt'));
    for (const path of ['../outside', '.git/config', '.env.local', 'private.pem', 'link.txt']) {
      await expect(service.readFile(path)).rejects.toThrow();
      await expect(service.proposeEdit(path, 'no')).rejects.toThrow();
    }
    expect(await service.readFile('ok.txt')).toBe('needle');
    expect((await service.searchWorkspace('needle')).map(m => m.path)).toEqual(['ok.txt']);
    expect(await service.searchWorkspace('secret')).toEqual([]);
  });
});

describe('approved commands', () => {
  it('does not spawn without explicit approval and passes the exact request for review', async () => {
    const request = { command: process.execPath, args: ['-e', 'console.log("executed")'] };
    await expect(service.runCommand(request)).rejects.toThrow(/approval/i);
    await service.dispose();
    let reviewed: unknown;
    service = await createWorkspace({ root, approveCommand: async r => { reviewed = r; return false; } });
    await expect(service.runCommand(request)).rejects.toThrow(/denied/i);
    expect(reviewed).toEqual(request);
    await service.dispose();
    service = await createWorkspace({ root, approveCommand: async () => true });
    expect(await service.runCommand(request)).toMatchObject({ stdout: 'executed\n', exitCode: 0 });
  });
  it('revalidates command cwd after the human approval boundary', async () => {
    await mkdir(join(root, 'cwd')); await service.dispose();
    service = await createWorkspace({ root, approveCommand: async () => { await rm(join(root, 'cwd'), { recursive: true }); await symlink(root, join(root, 'cwd')); return true; } });
    await expect(service.runCommand({ command: process.execPath, args: ['-e', 'console.log("unsafe")'], cwd: 'cwd' })).rejects.toThrow(/symlink/i);
  });
  it('waits for running processes to stop when disposed', async () => {
    await service.dispose(); service = await createWorkspace({ root, approveCommand: async () => true });
    const marker = join(root, 'pid');
    const running = service.runCommand({ command: process.execPath, args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000)`] });
    const cancelled = expect(running).rejects.toThrow(/cancel/i);
    let pid = 0;
    for (let attempt = 0; attempt < 100 && !pid; attempt++) { try { pid = Number(await readFile(marker, 'utf8')); } catch { await new Promise(resolve => setTimeout(resolve, 10)); } }
    expect(pid).toBeGreaterThan(0);
    await service.dispose();
    expect(() => process.kill(pid, 0)).toThrow(); await cancelled;
  });
  it('bounds output and time and supports cancellation during approval or execution', async () => {
    await service.dispose(); service = await createWorkspace({ root, approveCommand: async () => true });
    const output = await service.runCommand({ command: process.execPath, args: ['-e', 'process.stdout.write("a".repeat(200000))'] });
    expect(Buffer.byteLength(output.stdout)).toBeLessThanOrEqual(65536);
    expect(output.truncated).toBe(true);
    const slow = { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 40 };
    await expect(service.runCommand(slow)).rejects.toThrow(/timeout/i);
    const controller = new AbortController();
    const running = service.runCommand({ ...slow, timeoutMs: 30000 }, controller.signal);
    setTimeout(() => controller.abort(), 40);
    await expect(running).rejects.toThrow(/cancel|abort/i);
    await service.dispose();
    service = await createWorkspace({ root, approveCommand: () => new Promise(() => {}) });
    const pending = service.runCommand(slow); service.discardPending();
    await expect(pending).rejects.toThrow(/cancel|abort/i);
  });
});

describe('staged review', () => {
  it('does not publish proposals that were in flight when cancellation occurred', async () => {
    await writeFile(join(root, 'a.txt'), 'old');
    const pending = service.proposeEdit('a.txt', 'new'); service.discardPending();
    await expect(pending).rejects.toThrow(/cancel/i);
    expect(service.listProposals()).toEqual([]);
  });
  it('stages new files without creating them and removes only untouched accepted new files on undo', async () => {
    const p = await service.proposeEdit('new.txt', 'new content\n');
    await expect(readFile(join(root, 'new.txt'), 'utf8')).rejects.toThrow();
    await service.acceptHunk(p.id, p.hunks[0]!.id);
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('new content\n');
    await service.undo(); await expect(readFile(join(root, 'new.txt'), 'utf8')).rejects.toThrow();
    await service.acceptHunk(p.id, p.hunks[0]!.id);
    await writeFile(join(root, 'new.txt'), 'external');
    await expect(service.undo()).rejects.toThrow(/conflict/i);
    expect(await readFile(join(root, 'new.txt'), 'utf8')).toBe('external');
  });
  it('refuses empty proposals, binary replacements and oversized content', async () => {
    await writeFile(join(root, 'a.txt'), 'same');
    await expect(service.proposeEdit('a.txt', 'same')).rejects.toThrow(/change/i);
    await expect(service.proposeEdit('a.txt', 'bad\0content')).rejects.toThrow(/binary/i);
    await expect(service.proposeEdit('a.txt', 'x'.repeat(1024 * 1024 + 1))).rejects.toThrow(/limit/i);
  });
  it('refuses replacements that drop most of an existing file and supersedes pending proposals for the same path', async () => {
    const original = 'keep\\n'.repeat(80);
    await writeFile(join(root, 'a.txt'), original);
    await expect(service.proposeEdit('a.txt', 'def leftover():\\n  return 1\\n')).rejects.toThrow(/complete file/i);
    const first = await service.proposeEdit('a.txt', original.replace('keep', 'KEEP'));
    const second = await service.proposeEdit('a.txt', original.replace('keep', 'Stay'));
    expect(service.listProposals().find(proposal => proposal.id === first.id)?.status).toBe('rejected');
    expect(second.status).toBe('pending');
    await service.acceptHunk(second.id, second.hunks[0]!.id);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe(original.replace('keep', 'Stay'));
  });
  it('can reaccept an undone hunk without overwriting unrelated external edits', async () => {
    const original = 'first\n' + 'same\n'.repeat(12) + 'last\n';
    await writeFile(join(root, 'a.txt'), original);
    const p = await service.proposeEdit('a.txt', original.replace('first', 'FIRST'));
    await service.acceptHunk(p.id, p.hunks[0]!.id);
    await writeFile(join(root, 'a.txt'), original.replace('first', 'FIRST').replace('last', 'EXTERNAL'));
    await service.undo(); await service.acceptHunk(p.id, p.hunks[0]!.id);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe(original.replace('first', 'FIRST').replace('last', 'EXTERNAL'));
  });
  it('serializes concurrent hunk acceptance instead of losing changes', async () => {
    const original = 'first\n' + 'same\n'.repeat(12) + 'last\n';
    await writeFile(join(root, 'a.txt'), original);
    const p = await service.proposeEdit('a.txt', original.replace('first', 'FIRST').replace('last', 'LAST'));
    await Promise.all(p.hunks.map(h => service.acceptHunk(p.id, h.id)));
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe(p.proposed);
  });
  it('checks supplied content hashes and refuses stale acceptance', async () => {
    await writeFile(join(root, 'a.txt'), 'old\n');
    await expect(service.proposeEdit('a.txt', 'new\n', 'incorrect')).rejects.toThrow(/hash/i);
    const p = await service.proposeEdit('a.txt', 'new\n');
    await writeFile(join(root, 'a.txt'), 'external\n');
    await expect(service.acceptHunk(p.id, p.hunks[0]!.id)).rejects.toThrow(/stale/i);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('external\n');
  });
  it('undo preserves unrelated external changes and refuses conflicting changes', async () => {
    const original = 'first\n' + 'same\n'.repeat(12) + 'last\n';
    await writeFile(join(root, 'a.txt'), original);
    const p = await service.proposeEdit('a.txt', original.replace('first', 'FIRST'));
    await service.acceptHunk(p.id, p.hunks[0]!.id);
    await writeFile(join(root, 'a.txt'), original.replace('first', 'FIRST').replace('last', 'EXTERNAL'));
    await service.undo();
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe(original.replace('last', 'EXTERNAL'));
    expect(service.listProposals()[0]!.hunks[0]!.status).toBe('pending');
    const q = await service.proposeEdit('a.txt', original.replace('first', 'SECOND').replace('last', 'EXTERNAL'));
    await service.acceptHunk(q.id, q.hunks[0]!.id);
    await writeFile(join(root, 'a.txt'), 'conflicting\n');
    await expect(service.undo()).rejects.toThrow(/conflict/i);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('conflicting\n');
  });
  it('discards pending proposals on disposal but retains accepted writes', async () => {
    await writeFile(join(root, 'a.txt'), 'before\n');
    const p = await service.proposeEdit('a.txt', 'after\n');
    await service.acceptHunk(p.id, p.hunks[0]!.id);
    await service.dispose();
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe('after\n');
    await expect(service.proposeEdit('a.txt', 'bad')).rejects.toThrow(/disposed/i);
  });
  it('stages multiple hunks without writing and accepts only selected hunks across files', async () => {
    const original = 'first\n' + 'unchanged\n'.repeat(12) + 'last\n';
    await writeFile(join(root, 'a.txt'), original); await writeFile(join(root, 'b.txt'), 'old\n');
    const a = await service.proposeEdit('a.txt', original.replace('first', 'FIRST').replace('last', 'LAST'));
    const b = await service.proposeEdit('b.txt', 'new\n');
    expect(a.hunks).toHaveLength(2);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe(original);
    await service.acceptHunk(a.id, a.hunks[0]!.id);
    expect(await readFile(join(root, 'a.txt'), 'utf8')).toBe(original.replace('first', 'FIRST'));
    await service.rejectHunk(a.id, a.hunks[1]!.id);
    await service.acceptHunk(b.id, b.hunks[0]!.id);
    expect(service.listProposals().map(p => p.status)).toEqual(['partial', 'accepted']);
    await service.undo(); expect(await readFile(join(root, 'b.txt'), 'utf8')).toBe('old\n');
  });
});
