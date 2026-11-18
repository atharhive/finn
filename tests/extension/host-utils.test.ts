import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSettings, selectionPath, previewHunk } from '../../src/extension/host-utils.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive:true, force:true }))); });

it('validates explicit TrueForge configuration and provides an actionable no-model state', () => {
  expect(resolveSettings({}).ready).toBe(false);
  expect(resolveSettings({}).status).toContain('model');
  expect(resolveSettings({model:'catalog/model', trueforgeUrl:'http://127.0.0.1:3000'})).toMatchObject({ready:true, model:'catalog/model', baseUrl:'http://127.0.0.1:3000', contextBudget:8000});
  for(const url of ['file:///etc/passwd','https://user:secret@host','https://host/?key=secret']) expect(resolveSettings({model:'m',trueforgeUrl:url}).ready).toBe(false);
  expect(resolveSettings({model:'m', contextBudget:NaN}).contextBudget).toBe(8000);
});

it('blocks selection from secrets, symlinks and files outside the canonical workspace', async () => {
  const root = await mkdtemp(join(tmpdir(),'finn-selection-')); roots.push(root);
  await mkdir(join(root,'src')); await writeFile(join(root,'src','main.rs'),'fn main() {}');
  await writeFile(join(root,'.env'),'TOKEN=secret'); await writeFile(join(root,'.envrc'),'export SECRET=1'); await writeFile(join(root,'api-key.json'),'{}'); await symlink(join(root,'src'),join(root,'linked'));
  expect(await selectionPath(root,join(root,'src','main.rs'))).toBe('src/main.rs');
  for(const path of [join(root,'.env'),join(root,'.envrc'),join(root,'api-key.json'),join(root,'linked','main.rs'),'/etc/passwd']) await expect(selectionPath(root,path)).rejects.toThrow();
});

it('previews only the selected hunk, not other unaccepted edits', () => {
  const original = 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n';
  expect(previewHunk({original, hunks:[{id:'h',diff:'@@ -1,2 +1,2 @@\n-one\n+ONE\n two',status:'pending'}]},'h')).toBe(original.replace('one','ONE'));
  expect(() => previewHunk({original,hunks:[]},'missing')).toThrow();
});
