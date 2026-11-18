import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContextProvider, type ContextProvider } from '../../src/context/index.js';

const roots: string[] = [];
const providers: ContextProvider[] = [];
async function fixture(files: Record<string, string>) {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'finn-context-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
afterEach(async () => {
  await Promise.all(providers.splice(0).map(p => p.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

const binaryPath = '/home/ubuntu/finn/target/debug/finn_mcp';
async function provider(root: string) {
  const p = await createContextProvider({ root, binaryPath });
  providers.push(p);
  return p;
}

describe('context provider', () => {
  it('retrieves real source content through the reused Rust MCP engine', async () => {
    const root = await fixture({ 'src/auth.ts': 'export function authenticate() { return "access"; }' });
    const p = await provider(root);
    const bundle = await p.assemble({ query: 'authenticate auth', maxTokens: 2000 });
    expect(bundle.files.some(f => f.path === 'src/auth.ts' && f.content.includes('authenticate'))).toBe(true);
    expect(bundle.files[0]?.reasons.join(' ')).toMatch(/Rust/);
    expect(bundle.strategy).toMatch(/UTF-8/);
  });
  it('discovers source-body matches for the actual task rather than generic path relevance', async () => {
    const root = await fixture({
      'src/aaa.ts': 'export function irrelevant() { return "nothing"; }',
      'src/zzz.ts': 'export function normalizeCookie() { return "session expiry refresh"; }',
    });
    const p = await provider(root);
    const bundle = await p.assemble({ query: 'session expiry refresh', maxTokens: 2000 });
    expect(bundle.files[0]?.path).toBe('src/zzz.ts');
    expect(bundle.files[0]?.reasons.join(' ')).toMatch(/source.*session/i);
  });
  it('enforces conservative serialized file byte accounting without splitting source', async () => {
    const root = await fixture({ 'src/auth.ts': 'export const auth = "😀";'.repeat(10) });
    const p = await provider(root);
    const full = await p.assemble({ query: 'auth', maxTokens: 2000 });
    const file = full.files[0]!;
    expect(file.tokens).toBe(Buffer.byteLength(JSON.stringify({ path: file.path, content: file.content, reasons: file.reasons }), 'utf8'));
    const tiny = await p.assemble({ query: 'auth', maxTokens: 12 });
    expect(tiny.tokens).toBeLessThanOrEqual(12);
    expect(tiny.files).toEqual([]);
    expect(tiny.warnings.join(' ')).toMatch(/budget/i);
    const zero = await p.assemble({ query: 'auth', maxTokens: 0 });
    expect(zero.tokens).toBe(0);
    await expect(p.assemble({ query: 'auth', maxTokens: NaN })).rejects.toThrow(/budget/i);
    await expect(p.assemble({ query: 'auth', maxTokens: -1 })).rejects.toThrow(/budget/i);
  });
  it('never exposes ignored, secret, git or symlink files even if the engine selects them', async () => {
    const root = await fixture({
      '.gitignore': 'ignored.ts\n', 'ignored.ts': 'export const auth = "IGNORED";',
      '.env': 'auth=DOTENV', 'credentials.json': '{"auth":"CREDENTIALS"}',
      'private.pem': 'auth PRIVATEKEY', '.git/config': 'auth GITDATA',
      'src/.gitignore': 'hidden.ts\n', 'src/hidden.ts': 'export const auth = "NESTEDIGNORE";',
      'src/auth.ts': 'export const auth = "SAFE";',
    });
    const outside = await fixture({ 'outside.ts': 'export const auth = "ESCAPED";' });
    await symlink(join(outside, 'outside.ts'), join(root, 'escape.ts'));
    await symlink(outside, join(root, 'linked'));
    const p = await provider(root);
    const bundle = await p.assemble({ query: 'auth', maxTokens: 10000 });
    expect(bundle.files.map(f => f.path)).toEqual(['src/auth.ts']);
    expect(JSON.stringify(bundle)).not.toMatch(/IGNORED|DOTENV|CREDENTIALS|PRIVATEKEY|GITDATA|NESTEDIGNORE|ESCAPED/);
  });
  it('prioritizes explicit @file and @symbol mentions over automatic discovery', async () => {
    const root = await fixture({
      'src/aaa.ts': 'export const auth = "auth";',
      'src/zzz.ts': 'export function requestedSymbol() { return "unique"; }',
      'notes.md': 'human supplied context',
    });
    const p = await provider(root);
    const file = await p.assemble({ query: 'auth @file:notes.md', maxTokens: 3000 });
    expect(file.files[0]?.path).toBe('notes.md');
    expect(file.files[0]?.reasons.join(' ')).toMatch(/Explicit @file/);
    const symbol = await p.assemble({ query: 'auth', mentions: ['@symbol:requestedSymbol'], maxTokens: 3000 });
    expect(symbol.files[0]?.path).toBe('src/zzz.ts');
    expect(symbol.files[0]?.reasons.join(' ')).toMatch(/Explicit @symbol/);
    const duplicate = await p.assemble({ query: '@file:notes.md', mentions: ['@file:notes.md'], maxTokens: 3000 });
    expect(duplicate.files.filter(f => f.path === 'notes.md')).toHaveLength(1);
  });
  it('does not let explicit mentions bypass safety or ignore policy', async () => {
    const root = await fixture({ '.env': 'SECRET', '.gitignore': 'hidden.ts', 'hidden.ts': 'SECRET', 'ok.ts': 'export const value = 1;' });
    const outside = await fixture({ 'escape.ts': 'ESCAPED' });
    await symlink(outside, join(root, 'link'));
    const p = await provider(root);
    const bundle = await p.assemble({ query: '@file:.env @file:../escape.ts @file:link/escape.ts @file:hidden.ts @symbol:missing', maxTokens: 3000 });
    expect(bundle.files.map(f => f.path)).not.toContain('hidden.ts');
    expect(JSON.stringify(bundle)).not.toMatch(/SECRET|ESCAPED/);
    expect(bundle.warnings.filter(w => /mention/i.test(w))).toHaveLength(5);
  });
  it('rejects pre-cancelled work and reports a disposed provider explicitly', async () => {
    const root = await fixture({ 'src/auth.ts': 'export const auth = true;' });
    const p = await provider(root);
    const controller = new AbortController();
    controller.abort();
    await expect(p.assemble({ query: 'auth', maxTokens: 1000, signal: controller.signal })).rejects.toThrow(/abort/i);
    await p.dispose();
    await p.dispose();
    await expect(p.assemble({ query: 'auth', maxTokens: 1000 })).rejects.toThrow(/disposed/i);
  });
  it('cancels in-flight assembly without disposing the provider', async () => {
    const root = await fixture(Object.fromEntries(Array.from({ length: 80 }, (_, i) => [`src/f${i}.ts`, `export const auth${i} = true;`])));
    const p = await provider(root);
    const controller = new AbortController();
    const running = p.assemble({ query: 'auth', maxTokens: 1000, signal: controller.signal });
    controller.abort();
    await running.catch(() => undefined);
    const bundle = await p.assemble({ query: 'auth', maxTokens: 1000 });
    expect(bundle.files.length).toBeGreaterThan(0);
  });
  it('fails clearly instead of silently falling back when the Rust engine is missing', async () => {
    const root = await fixture({ 'src/example.ts': 'export const greeting = "hello";' });
    await expect(createContextProvider({ root, binaryPath: join(root, 'missing-engine') }))
      .rejects.toThrow(/Rust Finn engine unavailable/i);
  });
});
