import { runTests } from '@vscode/test-electron';
import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

if (process.platform === 'linux' && !process.env.DISPLAY && !process.argv.includes('--display-ready')) {
  const result = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1), '--display-ready'], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
await mkdir('dist/test', { recursive: true });
await build({ entryPoints: ['tests/vscode/index.ts'], outfile: 'dist/test/index.cjs', bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], target: 'node20' });
await runTests({
  version: 'stable',
  extensionDevelopmentPath: path.resolve('.'),
  extensionTestsPath: path.resolve('dist/test/index.cjs'),
  launchArgs: ['--no-sandbox', '--disable-gpu', '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--user-data-dir=' + path.resolve('.vscode-test/user-data')],
});
