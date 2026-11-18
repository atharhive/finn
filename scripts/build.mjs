import { build } from 'esbuild';
import { mkdir, copyFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/extension/index.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  sourcesContent: false,
  logLevel: 'info',
  legalComments: 'eof',
});
const executable = process.platform === 'win32' ? 'finn_mcp.exe' : 'finn_mcp';
const candidates = [process.env.FINN_ENGINE_PATH, path.join('target', 'release', executable), path.join('target', 'debug', executable)].filter(Boolean);
let copied = false;
for (const candidate of candidates) {
  try {
    await access(candidate, constants.R_OK);
    await mkdir('dist/bin', { recursive: true });
    await copyFile(candidate, path.join('dist/bin', executable));
    copied = true;
    break;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
if (!copied) throw new Error('Finn engine missing. Run npm run build:engine before packaging.');
