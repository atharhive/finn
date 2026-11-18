import { realpath, lstat } from 'node:fs/promises';
import { relative, isAbsolute, resolve, sep } from 'node:path';
import { applyPatch } from 'diff';
import { isDeniedName, isHardlink } from '../security.js';

export function resolveSettings(values: Record<string, unknown>): { ready: boolean; status: string; baseUrl: string; model: string; fallbackModel?: string; contextBudget: number; binaryPath?: string } {
  const model = typeof values.model === 'string' ? values.model.trim() : '';
  const baseUrl = typeof values.trueforgeUrl === 'string' && values.trueforgeUrl.trim() ? values.trueforgeUrl.trim() : 'http://127.0.0.1:8790';
  const contextBudget = Number.isSafeInteger(values.contextBudget) && Number(values.contextBudget) >= 512 && Number(values.contextBudget) <= 32768 ? Number(values.contextBudget) : 8000;
  const result = { model, baseUrl, contextBudget, fallbackModel: typeof values.fallbackModel === 'string' ? values.fallbackModel.trim() || undefined : undefined, binaryPath: typeof values.enginePath === 'string' ? values.enginePath.trim() || undefined : undefined };
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Invalid URL');
  } catch { return { ...result, ready: false, status: 'Set Finn: Trueforge Url to an HTTP(S) server URL without credentials or query parameters.' }; }
  if (!model) return { ...result, ready: false, status: 'Setup required: configure a model reference in Finn settings and start TrueForge. Provider credentials belong in TrueForge, never Finn.' };
  return { ...result, ready: true, status: 'Ready. Requests are sent to TrueForge; changes require your review.' };
}

/** Validate before obtaining or sending editor selection text, including dirty buffers. */
export async function selectionPath(root: string, filename: string): Promise<string> {
  const canonicalRoot = await realpath(root);
  const path = relative(canonicalRoot, resolve(filename));
  if (!path || isAbsolute(path) || path.split(sep).includes('..')) throw new Error('Select a file inside the first workspace folder.');
  const parts = path.split(sep);
  let current = canonicalRoot;
  for (const part of parts) {
    if (isDeniedName(part)) throw new Error('Finn cannot send credentials, secrets or Git internals.');
    current = resolve(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error('Finn does not send selections through symbolic links.');
    if (isHardlink(stat)) throw new Error('Finn does not send selections through hard links.');
  }
  const canonicalFile = await realpath(current);
  if (relative(canonicalRoot, canonicalFile).split(sep).includes('..')) throw new Error('Selection escapes workspace.');
  return parts.join('/');
}

export function previewHunk(proposal: {original: string; hunks: Array<{id: string; diff: string; status: string}>}, hunkId: string): string {
  const hunk = proposal.hunks.find(item => item.id === hunkId);
  if (!hunk) throw new Error('Hunk no longer available.');
  const result = applyPatch(proposal.original, `--- original\n+++ proposed\n${hunk.diff}\n`);
  if (result === false) throw new Error('Cannot preview this hunk.');
  return result;
}
