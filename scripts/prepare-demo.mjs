import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(args, schema) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !schema[key]) throw new Error(`Unknown option ${args[i]}; use --help`);
    if (schema[key] === 'boolean') result[key] = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${key} requires a value`);
      result[key] = args[++i];
    }
  }
  return result;
}

export function run(command, args, options = {}) {
  if (!options.quiet) console.log(`$ ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env }, encoding: 'utf8', timeout: options.timeout ?? 300000, maxBuffer: 16 * 1024 * 1024, shell: false });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  if (!options.quiet && output) process.stdout.write(output);
  if (result.error || result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unavailable'}): ${result.error?.message ?? output}. Check the command above and installed dependencies.`);
  return result.stdout;
}

export const FLASK_TAG = '3.1.3';
export const FLASK_PREFIX = '22d92470';
export const FLASK_URL = 'https://github.com/pallets/flask.git';

export function validateRevision(revision) {
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error('Expected a full 40-character Git commit SHA');
  if (!revision.startsWith(FLASK_PREFIX)) throw new Error(`Expected Flask ${FLASK_TAG} commit prefix ${FLASK_PREFIX}, got ${revision}`);
  return revision;
}

export function pythonInstallCommand(python, repo, hasUv) {
  const dependencies = ['-e', repo, 'pytest>=8,<9', 'asgiref>=3.2', 'python-dotenv>=1'];
  return hasUv ? ['uv', ['pip', 'install', '--python', python, ...dependencies]] : [python, ['-m', 'pip', 'install', ...dependencies]];
}

export function main(args = process.argv.slice(2)) {
  const flags = parseArgs(args, { help: 'boolean', dir: 'value', python: 'value', 'skip-tests': 'boolean' });
  if (flags.help) {
    console.log('Usage: node scripts/prepare-demo.mjs --dir <NEW external directory> [--python python3] [--skip-tests]\nClones official Flask 3.1.3 twice, creates an external Python environment, installs test dependencies, runs baseline test_cli. Does not generate task solutions. Existing directories are never overwritten.');
    return;
  }
  if (!flags.dir) throw new Error('Pass --dir with a NEW external demo directory; see --help');
  const root = resolve(flags.dir);
  if (existsSync(root)) throw new Error(`${root} already exists. Choose a new directory; no reset or deletion is performed.`);
  mkdirSync(root, { recursive: true });
  const repo = join(root, 'flask');
  const cleanRepo = join(root, 'flask-c');
  const env = join(root, '.venv');
  for (const destination of [repo, cleanRepo]) {
    run('git', ['clone', '--depth', '1', '--branch', FLASK_TAG, FLASK_URL, destination]);
    validateRevision(run('git', ['rev-parse', 'HEAD'], { cwd: destination, quiet: true }).trim());
    const status = run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: destination, quiet: true });
    if (status) throw new Error(`Fresh clone is not clean: ${destination}`);
  }
  const hasUv = spawnSync('uv', ['--version'], { encoding: 'utf8' }).status === 0;
  if (hasUv) run('uv', ['venv', '--python', flags.python ?? 'python3', env]);
  else run(flags.python ?? 'python3', ['-m', 'venv', env]);
  const python = join(env, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  const [installer, installArgs] = pythonInstallCommand(python, repo, hasUv);
  run(installer, installArgs);
  const manifest = { schemaVersion: 1, tag: FLASK_TAG, commit: run('git', ['rev-parse', 'HEAD'], { cwd: repo, quiet: true }).trim(), repo, cleanRepo, python, baselineTests: 'not-run' };
  // Persist partial setup metadata so an interrupted install/test has an actionable location.
  writeFileSync(join(root, 'demo.json'), JSON.stringify(manifest, null, 2) + '\n');
  const freeze = hasUv ? run('uv', ['pip', 'freeze', '--python', python], { quiet: true }) : run(python, ['-m', 'pip', 'freeze'], { quiet: true });
  writeFileSync(join(root, 'python-freeze.txt'), freeze);
  if (!flags['skip-tests']) {
    run(python, ['-m', 'pytest', 'tests/test_cli.py', '-q', '-p', 'no:cacheprovider'], { cwd: repo, env: { PYTHONDONTWRITEBYTECODE: '1' } });
    manifest.baselineTests = 'passed';
    writeFileSync(join(root, 'demo.json'), JSON.stringify(manifest, null, 2) + '\n');
  }
  console.log(`Prepared only (not an agent demonstration): ${root}\nTasks A/B: ${repo}\nTask C clean workspace: ${cleanRepo}\nPython: ${python}\nRead docs/demo.md, then perform each task through Finn in VS Code.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Demo preparation failed: ${error.message}`); process.exitCode = 1; }
}
