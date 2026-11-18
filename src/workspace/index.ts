import { realpath, lstat, readdir, unlink } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { structuredPatch, applyPatch, reversePatch, type StructuredPatch } from 'diff';
import { withWorkspaceFile } from './files.js';
import { startBridge, type McpBridge } from './mcp.js';
import { abortable, executeCommand, type CommandResult } from './commands.js';
import { isDeniedName, isHardlink } from '../security.js';
import type { CommandRequest, ContextRequest, ContextBundle } from '../contracts.js';

export interface Proposal {
  id: string; path: string; original: string; proposed: string;
  hunks: Array<{ id: string; diff: string; status: 'pending' | 'accepted' | 'rejected' }>;
  status: 'pending' | 'accepted' | 'rejected' | 'partial';
}
export interface WorkspaceOptions {
  root: string;
  onChange?: (proposals: Proposal[]) => void;
  approveCommand?: (request: CommandRequest) => Promise<boolean>;
  contextProvider?: (request: ContextRequest) => Promise<ContextBundle>;
}
export interface WorkspaceService {
  listProposals(): Proposal[];
  startMcpServer(): Promise<{ url: string; token: string }>;
  assembleContext(request: ContextRequest): Promise<ContextBundle>;
  runCommand(request: CommandRequest, signal?: AbortSignal): Promise<CommandResult>;
  readFile(path: string): Promise<string>;
  searchWorkspace(query: string): Promise<Array<{ path: string; line: number; text: string }>>;
  proposeEdit(path: string, content: string, originalHash?: string): Promise<Proposal>;
  acceptHunk(proposalId: string, hunkId: string): Promise<void>;
  rejectHunk(proposalId: string, hunkId: string): Promise<void>;
  undo(): Promise<void>;
  discardPending(): void;
  dispose(): Promise<void>;
}
export async function createWorkspace(options: WorkspaceOptions): Promise<WorkspaceService> {
  const root = await realpath(options.root);
  let disposed = false;
  let generation = 0;
  const active = () => { if (disposed) throw new Error('Workspace is disposed'); };
  const denied = (part: string) => isDeniedName(part);
  const safePath = async (path: string, allowMissing = false): Promise<string> => {
    active();
    if (!path || path.includes('\0') || path.includes('\\') || isAbsolute(path)) throw new Error('Unsafe workspace path');
    const parts = path.split('/');
    if (parts.some(p => p === '..' || denied(p))) throw new Error('Forbidden workspace path');
    let current = root;
    for (const part of parts) {
      current = resolve(current, part);
      let stat;
      try { stat = await lstat(current); } catch (error) { if (allowMissing && part === parts.at(-1) && (error as NodeJS.ErrnoException).code === 'ENOENT') return current; throw error; }
      if (stat.isSymbolicLink()) throw new Error('Symlink paths are forbidden');
    }
    const canonical = await realpath(current);
    if (relative(root, canonical).startsWith('..') || isAbsolute(relative(root, canonical))) throw new Error('Path escapes workspace');
    return canonical;
  };
  const read = async (path: string) => {
    const filename = await safePath(path); const stat = await lstat(filename);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error('File exceeds limit or is not a regular file');
    if (isHardlink(stat)) throw new Error('Hardlinked files are forbidden');
    const text = await withWorkspaceFile(root, path, false, file => file.readFile('utf8'));
    if (text.includes('\0')) throw new Error('Binary files are not exposed');
    return text;
  };
  const write = async (path: string, previous: string | null, next: string) => {
    await safePath(path, previous === null);
    await withWorkspaceFile(root, path, previous === null ? 'create' : true, async file => {
      const current = await file.readFile('utf8');
      if (previous !== null && current !== previous) throw new Error('Stale file: content changed before write');
      active();
      const bytes = Buffer.from(next, 'utf8');
      await file.write(bytes, 0, bytes.length, 0); await file.truncate(bytes.length);
    });
  };
  const readOptional = async (path: string): Promise<string | null> => {
    await safePath(path, true);
    try { return await read(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  };
  let bridge: Promise<McpBridge> | undefined;
  const operations = new Set<AbortController>();
  const completions = new Set<Promise<void>>();
  const trackCompletion = () => {
    let finish!: () => void;
    const completion = new Promise<void>(resolve => { finish = resolve; }); completions.add(completion);
    return () => { completions.delete(completion); finish(); };
  };
  const proposals: Proposal[] = [];
  const patches = new Map<string, StructuredPatch>();
  const expected = new Map<string, string | null>();
  const history: Array<{ path: string; patch: StructuredPatch; created: boolean; proposal: Proposal; hunk: Proposal['hunks'][number] }> = [];
  const notify = () => options.onChange?.(structuredClone(proposals));
  const lookup = (id: string, hid: string) => {
    active();
    const proposal = proposals.find(p => p.id === id);
    const hunk = proposal?.hunks.find(h => h.id === hid);
    if (!proposal || !hunk || hunk.status !== 'pending') throw new Error('Unknown or resolved hunk');
    return { proposal, hunk };
  };
  const status = (p: Proposal) => {
    const states = new Set(p.hunks.map(h => h.status));
    p.status = states.size === 1 ? p.hunks[0]!.status : 'partial';
    notify();
  };
  const service: WorkspaceService = {
    listProposals: () => structuredClone(proposals),
    readFile: read,
    async startMcpServer() {
      active(); bridge ??= startBridge(service);
      const { url, token } = await bridge; return { url, token };
    },
    async assembleContext(request) {
      active();
      if (!options.contextProvider) throw new Error('Context provider is unavailable');
      if (!request.query || !Number.isInteger(request.maxTokens) || request.maxTokens < 1 || request.maxTokens > 32768) throw new Error('Invalid context request');
      const controller = new AbortController(); operations.add(controller); const finish = trackCompletion();
      const abort = () => controller.abort(new Error('Context cancelled'));
      request.signal?.addEventListener('abort', abort, { once: true });
      if (request.signal?.aborted) abort();
      const timer = setTimeout(() => controller.abort(new Error('Context timeout')), 30000);
      try {
        for (const path of request.mentions ?? []) await safePath(path);
        controller.signal.throwIfAborted();
        const bundle = await abortable(options.contextProvider({ ...request, signal: controller.signal }), controller.signal);
        for (const file of bundle.files) await read(file.path);
        controller.signal.throwIfAborted(); active(); return bundle;
      } finally { clearTimeout(timer); operations.delete(controller); finish(); request.signal?.removeEventListener('abort', abort); }
    },
    async runCommand(request, signal) {
      active();
      if (!options.approveCommand) throw new Error('Human command approval is required');
      const copy = structuredClone(request);
      if (!copy.command || copy.command.includes('\0') || !Array.isArray(copy.args) || copy.args.some(a => typeof a !== 'string' || a.includes('\0'))) throw new Error('Invalid command');
      const controller = new AbortController(); operations.add(controller); const finish = trackCompletion();
      const abort = () => controller.abort(new Error('Command cancelled'));
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      const timeoutMs = Math.min(30000, Math.max(1, copy.timeoutMs ?? 30000));
      const timer = setTimeout(() => controller.abort(new Error('Command timeout')), timeoutMs);
      try {
        const cwd = await safePath(copy.cwd ?? '.');
        controller.signal.throwIfAborted();
        const approved = await abortable(options.approveCommand(structuredClone(copy)), controller.signal);
        controller.signal.throwIfAborted(); active();
        if (approved !== true) throw new Error('Human command approval denied');
        const approvedCwd = await safePath(copy.cwd ?? '.');
        if (approvedCwd !== cwd) throw new Error('Command cwd changed during approval');
        return await executeCommand(copy, approvedCwd, controller.signal);
      } finally { clearTimeout(timer); operations.delete(controller); finish(); signal?.removeEventListener('abort', abort); }
    },
    async searchWorkspace(query) {
      if (!query || query.length > 1024) throw new Error('Invalid search query');
      const matches: Array<{ path: string; line: number; text: string }> = [];
      let visited = 0;
      const walk = async (directory: string) => {
        for (const entry of await readdir(await safePath(directory), { withFileTypes: true })) {
          if (++visited > 10000 || matches.length >= 200) return;
          if (denied(entry.name) || entry.isSymbolicLink() || ['node_modules', 'target', 'dist'].includes(entry.name)) continue;
          const path = directory === '.' ? entry.name : `${directory}/${entry.name}`;
          if (entry.isDirectory()) await walk(path);
          else if (entry.isFile()) {
            try { const content = await read(path); for (const [index, text] of content.split('\n').entries()) {
              if (text.includes(query) && matches.length < 200) matches.push({ path, line: index + 1, text: text.slice(0, 2048) });
            } } catch { /* Unsafe, oversized and binary files are deliberately excluded. */ }
          }
        }
      };
      await walk('.'); return matches;
    },
    async proposeEdit(path, content, originalHash) {
      active(); const started = generation;
      if (content.includes('\0')) throw new Error('Binary replacement forbidden');
      if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) throw new Error('Replacement exceeds file limit');
      const previous = await readOptional(path); const original = previous ?? '';
      active(); if (started !== generation) throw new Error('Proposal cancelled');
      if (original === content) throw new Error('Proposal contains no changes');
      if (previous !== null && Buffer.byteLength(previous, 'utf8') >= 200 && Buffer.byteLength(content, 'utf8') < Buffer.byteLength(previous, 'utf8') / 2) throw new Error('Replacement must be the complete file contents; this proposal would drop most of the existing file.');
      if (originalHash !== undefined && originalHash !== createHash('sha256').update(original).digest('hex')) throw new Error('Original hash mismatch');
      const patch = structuredPatch(path, path, original, content);
      const proposal: Proposal = { id: randomUUID(), path, original, proposed: content,
        hunks: patch.hunks.map(h => ({ id: randomUUID(), diff: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@\n${h.lines.join('\n')}`, status: 'pending' })), status: 'pending' };
      for (const existing of proposals) {
        if (existing.path === path && existing.status === 'pending') {
          existing.status = 'rejected';
          for (const hunk of existing.hunks) if (hunk.status === 'pending') hunk.status = 'rejected';
        }
      }
      proposals.push(proposal); patches.set(proposal.id, patch); expected.set(proposal.id, previous); notify();
      return structuredClone(proposal);
    },
    async acceptHunk(id, hid) {
      const { proposal, hunk } = lookup(id, hid);
      const current = await readOptional(proposal.path);
      if (current !== expected.get(id)) throw new Error('Stale file: content changed since proposal');
      const patch = patches.get(id)!;
      const next = applyPatch(current ?? '', { ...patch, hunks: patch.hunks.filter((_, i) => proposal.hunks[i]!.id === hid) });
      if (next === false) throw new Error('Cannot apply hunk');
      await write(proposal.path, current, next); history.push({ path: proposal.path, created: current === null, proposal, hunk, patch: structuredPatch(proposal.path, proposal.path, current ?? '', next) });
      expected.set(id, next); hunk.status = 'accepted'; status(proposal);
    },
    async rejectHunk(id, hid) { const { proposal, hunk } = lookup(id, hid); hunk.status = 'rejected'; status(proposal); },
    async undo() {
      const entry = history.at(-1); if (!entry) return;
      const current = await read(entry.path);
      const next = applyPatch(current, reversePatch(entry.patch));
      if (entry.created) {
        if (current !== entry.proposal.proposed) throw new Error('Undo conflicts with external edits');
        await safePath(entry.path);
        await withWorkspaceFile(root, entry.path, true, async (file, anchoredPath) => {
          if (await file.readFile('utf8') !== current) throw new Error('Undo conflicts with external edits');
          active(); await unlink(anchoredPath);
        });
        history.pop(); entry.hunk.status = 'pending'; expected.set(entry.proposal.id, null); status(entry.proposal); return;
      }
      if (next === false) throw new Error('Undo conflicts with external edits');
      await write(entry.path, current, next); history.pop();
      entry.hunk.status = 'pending'; expected.set(entry.proposal.id, next); status(entry.proposal);
    },
    discardPending() { generation++; for (const operation of operations) operation.abort(new Error('Command cancelled')); for (const p of proposals) { for (const h of p.hunks) if (h.status === 'pending') h.status = 'rejected'; if (p.hunks.length) status(p); } },
    async dispose() {
      if (disposed) return; disposed = true; service.discardPending();
      await Promise.all([...completions]); await reviewQueue;
      if (bridge) await (await bridge).close();
    },
  };
  // Serialize review mutations: concurrent UI messages must not overwrite each other.
  let reviewQueue = Promise.resolve();
  const serialize = <A extends unknown[]>(operation: (...args: A) => Promise<void>) => (...args: A) => {
    const result = reviewQueue.then(() => operation(...args));
    reviewQueue = result.catch(() => {}); return result;
  };
  service.acceptHunk = serialize(service.acceptHunk);
  service.rejectHunk = serialize(service.rejectHunk);
  service.undo = serialize(service.undo);
  return service;
}
