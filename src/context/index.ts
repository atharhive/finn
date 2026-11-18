import { access, realpath, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import type { ContextBundle, ContextRequest } from '../contracts.js';
import { inventory } from './inventory.js';

export interface ContextProvider {
  assemble(request: ContextRequest): Promise<ContextBundle>;
  dispose(): Promise<void>;
}
type EngineFile = { path: string; reasons: string[] };
type Candidate = { path: string; content: string; reasons: string[]; score: number };

export async function createContextProvider(options: { root: string; binaryPath?: string }): Promise<ContextProvider> {
  const root = await realpath(options.root);
  const binaryPath = resolve(options.binaryPath ?? resolve(root, 'target/debug/finn_mcp'));
  try { await access(binaryPath, constants.X_OK); }
  catch (error) { throw new Error(`Rust Finn engine unavailable at ${binaryPath}`, { cause: error }); }
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const client = new Client({ name: 'finn-context', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: binaryPath, args: ['--transport', 'stdio'], cwd: root, stderr: 'pipe' });
  transport.stderr?.on('data', () => { /* Drain logs without exposing engine/file contents. */ });
  try { await client.connect(transport, { timeout: 15_000 }); }
  catch (error) {
    await transport.close();
    throw new Error(`Rust Finn engine unavailable at ${binaryPath}`, { cause: error });
  }
  let disposed = false;
  let closing: Promise<void> | undefined;
  const lifetime = new AbortController();
  function dispose() {
    if (disposed) return closing ?? Promise.resolve();
    disposed = true;
    lifetime.abort();
    return closing = client.close();
  }
  return {
    async assemble(request) {
      if (disposed) throw new Error('Context provider disposed; create a new provider');
      request.signal?.throwIfAborted();
      if (!Number.isSafeInteger(request.maxTokens) || request.maxTokens < 0) throw new Error('Context budget must be a nonnegative safe integer');
      const signal = AbortSignal.any([lifetime.signal, ...(request.signal ? [request.signal] : [])]);
      const onAbort = () => { void dispose().catch(() => {}); };
      signal.addEventListener('abort', onAbort, { once: true });
      try {
      const scanned = await inventory(root, signal);
      // Rust is reused unchanged against a private sanitized snapshot. Disallowed
      // source files never reach its content reader, parser, graph or reporting.
      const snapshot = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'finn-engine-'));
      try {
        for (const [path, content] of scanned.files) {
          signal.throwIfAborted();
          await mkdir(dirname(join(snapshot, path)), { recursive: true });
          await writeFile(join(snapshot, path), content, { mode: 0o600 });
        }
        const result = await client.callTool({ name: 'optimize_context', arguments: {
          root: snapshot, query: request.query, max_tokens: Math.max(request.maxTokens, 1),
        } }, undefined, { timeout: 30_000, signal });
        if (result.isError) throw new Error('Rust Finn engine optimize_context failed');
        const blocks = result.content as Array<{ type: string; text?: string }>;
        const data = JSON.parse(blocks.filter(b => b.type === 'text').map(b => b.text).join('')) as {
          selected: EngineFile[]; warnings: string[];
        };
        const warnings = [...scanned.warnings];
        if (data.warnings.length) warnings.push(`Rust optimizer reported ${data.warnings.length} warning(s)`);
        const candidates = new Map<string, Candidate>();
        for (const f of data.selected) {
          const content = scanned.files.get(f.path);
          if (content !== undefined) candidates.set(f.path, { path: f.path, content,
            reasons: ['Rust repository/dependency optimizer', ...f.reasons], score: 1 });
        }
        const terms = [...new Set(request.query.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [])];
        for (const [path, content] of scanned.files) {
          const matches = terms.filter(term => content.toLowerCase().includes(term));
          if (!matches.length) continue;
          const previous = candidates.get(path);
          candidates.set(path, { path, content, score: matches.length * 10 + (previous?.score ?? 0),
            reasons: [...(previous?.reasons ?? []), `Source task matches: ${matches.join(', ')}`] });
        }
        const mentionText = [request.query, ...(request.mentions ?? []).map(m => m.startsWith('@') ? m : `@file:${m}`)].join(' ');
        const mentions = new Map<string, { kind: string; value: string }>();
        for (const match of mentionText.matchAll(/@(file|symbol)(?::([^\s,;)]+)|\(([^)]+)\)|\s+([^\s,;]+))/g)) {
          const kind = match[1]!;
          const value = match[2] ?? match[3] ?? match[4]!;
          mentions.set(`${kind}:${value}`, { kind, value });
        }
        for (const { kind, value } of mentions.values()) {
          const matches = kind === 'file'
            ? [...scanned.files.keys()].filter(path => path === value)
            : /^[A-Za-z_$][\w$]*$/.test(value)
              ? [...scanned.files].filter(([, content]) => new RegExp(`\\b(?:function|class|def|fn|struct|enum|interface|type|const|let|var|trait)\\s+${value.replace(/[$]/g, '\\$&')}\\b`).test(content)).map(([path]) => path)
              : [];
          if (!matches.length) warnings.push(`Unresolved or denied @${kind} mention: ${value}`);
          for (const path of matches) {
            const previous = candidates.get(path);
            candidates.set(path, { path, content: scanned.files.get(path)!,
              score: Math.max(previous?.score ?? 0, kind === 'file' ? 1_000_000 : 100_000),
              reasons: [...(previous?.reasons ?? []), `Explicit @${kind}: ${value}`] });
          }
        }
        const files = [];
        let tokens = 0;
        for (const { score: _score, ...f } of [...candidates.values()].sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))) {
          const cost = Buffer.byteLength(JSON.stringify(f), 'utf8');
          if (tokens + cost > request.maxTokens) { warnings.push(`Budget excluded ${f.path} (${cost} conservative tokens)`); continue; }
          files.push({ ...f, tokens: cost });
          tokens += cost;
        }
        return { files, tokens, budget: request.maxTokens,
          strategy: 'Rust optimizer + source lexical ranking; whole files, conservative UTF-8 bytes of JSON {path,content,reasons}, not tokenizer precision', warnings };
      } finally { await rm(snapshot, { recursive: true, force: true }); }
      } finally { signal.removeEventListener('abort', onAbort); }
    },
    dispose,
  };
}
