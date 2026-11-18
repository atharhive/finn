import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { inventory } from '../../src/context/inventory.js';
const roots: string[] = [];
async function fixture(files: Record<string, string | Buffer>) {
  const root = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), 'finn-inventory-'));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('denies environment scripts and API key material as well as standard credential files', async () => {
  const root = await fixture({ '.envrc': 'PRIVATE', 'api-key.json': 'PRIVATE', 'src/auth.ts': 'safe' });
  expect([...(await inventory(root)).files.keys()]).toEqual(['src/auth.ts']);
});

it('denies Docker auth and service-account credential files in the source inventory', async () => {
  const root = await fixture({ '.docker/config.json': 'PRIVATE', 'service-account.json': 'PRIVATE', 'src/a.ts': 'safe' });
  expect([...(await inventory(root)).files.keys()]).toEqual(['src/a.ts']);
});
