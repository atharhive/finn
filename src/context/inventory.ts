import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import ignore, { type Ignore } from 'ignore';

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SCAN_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 4000;
const excluded = /^(?:\.git|\.hg|\.svn|node_modules|target|dist|build|coverage|\.next|\.env(?:rc|\..*)?|api[-_]key(?:\..*)?|\.ssh|\.docker|service[-_]account(?:\..*)?|\.aws|\.azure|\.kube|\.npmrc|\.netrc|\.pypirc|\.gitignore|\.ignore|\.finnignore|.*\.(?:pem|key|p12|pfx|keystore)|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|(?:.*[._-])?(?:credentials?|secrets?|tokens?)(?:[._-].*)?)$/i;

// Reject symlinks at every component, including inside-root links. Never trust
// engine-supplied contents: both the engine snapshot and output use this inventory.
async function readSafe(root: string, path: string): Promise<Buffer | undefined> {
  if (!path || path.includes('\\') || path.startsWith('/') || path.split('/').some(p => p === '.' || p === '..' || !p)) return;
  const absolute = resolve(root, path);
  let cursor = root;
  for (const part of path.split('/')) {
    cursor = resolve(cursor, part);
    if ((await lstat(cursor)).isSymbolicLink()) return;
  }
  if (await realpath(absolute) !== absolute) return;
  const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return;
    // Read a bounded buffer, even if the file grows after stat.
    const buffer = Buffer.alloc(MAX_FILE_BYTES + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > MAX_FILE_BYTES || await realpath(absolute) !== absolute) return;
    return buffer.subarray(0, bytesRead);
  } finally { await handle.close(); }
}

type Rule = { base: string; matcher: Ignore };
export async function inventory(root: string, signal?: AbortSignal): Promise<{ files: Map<string, string>; warnings: string[] }> {
  const files = new Map<string, string>();
  const warnings: string[] = [];
  let bytes = 0;
  let visited = 0;
  async function walk(dir: string, inherited: Rule[]) {
    signal?.throwIfAborted();
    const rules = [...inherited];
    for (const name of ['.gitignore', '.ignore', '.finnignore']) {
      try {
        const content = await readSafe(root, dir ? `${dir}/${name}` : name);
        if (content) rules.push({ base: dir, matcher: ignore().add(content.toString('utf8')) });
      } catch { /* Missing ignore files are normal. */ }
    }
    const entries = (await readdir(resolve(root, dir), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      signal?.throwIfAborted();
      if (++visited > MAX_FILES || bytes >= MAX_SCAN_BYTES) {
        if (!warnings.includes('Repository scan limit reached; context discovery is incomplete')) warnings.push('Repository scan limit reached; context discovery is incomplete');
        return;
      }
      const path = dir ? `${dir}/${entry.name}` : entry.name;
      if (excluded.test(entry.name) || entry.isSymbolicLink()) continue;
      if (rules.some(rule => rule.matcher.ignores(path.slice(rule.base ? rule.base.length + 1 : 0) + (entry.isDirectory() ? '/' : '')))) continue;
      if (entry.isDirectory()) {
        // Recheck canonical directory before enumeration.
        if (await realpath(resolve(root, path)) === resolve(root, path)) await walk(path, rules);
      } else if (entry.isFile()) {
        try {
          const raw = await readSafe(root, path);
          if (!raw) { warnings.push(`Skipped oversized or unsafe file: ${path}`); continue; }
          if (raw.includes(0)) continue;
          const content = new TextDecoder('utf-8', { fatal: true }).decode(raw);
          if (bytes + raw.length > MAX_SCAN_BYTES) { warnings.push('Repository scan limit reached; context discovery is incomplete'); return; }
          bytes += raw.length;
          files.set(path, content);
        } catch { warnings.push(`Skipped unreadable or non-UTF-8 file: ${path}`); }
      }
    }
  }
  await walk('', []);
  return { files, warnings };
}
