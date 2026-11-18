import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, lstatSync, readlinkSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, delimiter, isAbsolute, sep, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, run, validateRevision } from './prepare-demo.mjs';

export function validateOutputPath(output, workspaces) {
  const absolute = resolve(output);
  for (const workspace of workspaces) {
    const rel = relative(resolve(workspace), absolute);
    if (rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))) throw new Error('--output must be outside both Flask checkouts');
  }
  return absolute;
}

export function changedFiles(before, after) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(path => before[path] !== after[path]).sort();
}

export function snapshot(repo) {
  const commit = validateRevision(run('git', ['rev-parse', 'HEAD'], { cwd: repo, quiet: true }).trim());
  const status = run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repo, quiet: true });
  const paths = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, quiet: true }).split('\0').filter(Boolean);
  const files = {};
  for (const path of [...new Set(paths)].sort()) {
    const full = join(repo, path);
    if (!existsSync(full)) { files[path] = 'deleted'; continue; }
    const stat = lstatSync(full);
    const content = stat.isSymbolicLink() ? `symlink:${readlinkSync(full)}` : readFileSync(full);
    files[path] = createHash('sha256').update(content).update(`:${stat.mode & 0o777}`).digest('hex');
  }
  return { repo: resolve(repo), commit, status, files };
}

export function main(args = process.argv.slice(2)) {
  const flags = parseArgs(args, { help: 'boolean', dir: 'value', task: 'value', baseline: 'value', output: 'value' });
  if (flags.help) {
    console.log('Usage: node scripts/verify-demo.mjs --dir <prepared directory> --task <a|snapshot-b|b|snapshot-c|c> [--baseline <JSON>] [--output <NEW external JSON>]\nSnapshot modes require --output. Tasks b/c require --baseline. Executes verification only, NEVER generates or installs task solutions. Task C verifies filesystem evidence only; record the failing run and responsive editor separately.');
    return;
  }
  if (!flags.dir) throw new Error('Pass --dir pointing to the prepared demo directory (contains demo.json)');
  if (!['a', 'snapshot-b', 'b', 'snapshot-c', 'c'].includes(flags.task)) throw new Error('Choose --task a, snapshot-b, b, snapshot-c or c');
  const root = resolve(flags.dir);
  const manifest = JSON.parse(readFileSync(join(root, 'demo.json'), 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported demo.json; prepare a new demo directory');
  const repo = flags.task.endsWith('c') ? manifest.cleanRepo : manifest.repo;
  const current = snapshot(repo);
  const save = value => {
    if (!flags.output) return;
    const output = validateOutputPath(flags.output, [manifest.repo, manifest.cleanRepo]);
    writeFileSync(output, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  };
  if (flags.task.startsWith('snapshot-')) {
    if (!flags.output) throw new Error('Snapshot requires --output <NEW external JSON>');
    if (flags.task === 'snapshot-c' && current.status !== '') throw new Error('Task C requires a clean workspace before the failing run');
    save({ task: flags.task, ...current });
    console.log(`Saved ${flags.task} baseline; no task has been demonstrated by this action.`);
    return;
  }
  const checks = [];
  const check = (name, operation) => {
    try { const evidence = operation(); checks.push({ name, passed: true, evidence }); console.log(`PASS ${name}`); }
    catch (error) { checks.push({ name, passed: false, error: error.message }); console.error(`FAIL ${name}: ${error.message}`); }
  };
  const pythonEnv = { PYTHONDONTWRITEBYTECODE: '1', PYTHONPATH: join(repo, 'src'), FLASK_SKIP_DOTENV: '1', FLASK_DEBUG: '', FLASK_APP: '' };
  const python = (args, env = {}) => run(manifest.python, args, { cwd: repo, env: { ...pythonEnv, ...env } });
  if (flags.task === 'a') {
    check('official FLASK_DEBUG=off command', () => {
      const output = python(['-c', 'from flask.helpers import get_debug_flag; print(get_debug_flag())'], { FLASK_DEBUG: 'off' }).trim();
      if (output !== 'False') throw new Error(`Expected False, got ${output}; run Task A in Finn and accept the diff`);
      return output;
    });
    check('mixed-case false and truthy regression cases', () => {
      const code = `import os,json\nfrom flask.helpers import get_debug_flag\nresult={}\nfor value in ${JSON.stringify(Object.keys(DEBUG_CASES))}:\n os.environ['FLASK_DEBUG']=value\n result[value]=get_debug_flag()\nprint(json.dumps(result))`;
      const observations = JSON.parse(python(['-c', code]));
      validateDebugFlags(observations);
      return observations;
    });
    check('docstring lists false values', () => {
      const doc = python(['-c', 'from flask.helpers import get_debug_flag; print(get_debug_flag.__doc__)']).toLowerCase();
      for (const value of ['0', 'false', 'no', 'off', 'n']) {
        if (!new RegExp(`(^|[^a-z0-9])${value}([^a-z0-9]|$)`).test(doc)) throw new Error(`Docstring must explicitly list ${value}`);
      }
      if (!/empty|unset|not set|not defined/.test(doc)) throw new Error('Docstring must also describe empty or unset FLASK_DEBUG');
      return doc;
    });
  } else {
    if (!flags.baseline) throw new Error(`Task ${flags.task} requires --baseline from snapshot-${flags.task} before the UI run`);
    const baseline = JSON.parse(readFileSync(resolve(flags.baseline), 'utf8'));
    if (baseline.task !== `snapshot-${flags.task}` || baseline.repo !== current.repo || baseline.commit !== current.commit) throw new Error('Baseline belongs to a different task, workspace or commit');
    if (flags.task === 'c') {
      check('Task C clean unchanged filesystem (not proof of a model run)', () => { validateCleanSnapshot(baseline, current); return { status: current.status, commit: current.commit, unchanged: true }; });
    } else {
      check('Task B at least three new edited implementation/test/docs files', () => {
        const files = changedFiles(baseline.files, current.files);
        validateTaskBFiles(files);
        return files;
      });
      check('pytest tests/test_cli.py -q', () => python(['-m', 'pytest', 'tests/test_cli.py', '-q', '-p', 'no:cacheprovider']));
      check('flask --help lists config', () => { const output = python(['-m', 'flask', '--help']); validateHelp(output); return output; });
      check('loaded application config is masked JSON', () => {
        const fixture = mkdtempSync(join(root, 'config-probe-'));
        try {
          writeFileSync(join(fixture, 'finn_demo_app.py'), `from flask import Flask\napp = Flask(__name__)\napp.config.update(SECRET_KEY='demo-secret', DATABASE_PASSWORD='demo-password', ACCESS_TOKEN='demo-token', API_KEY='demo-key', PREFIX_SECRET_SUFFIX='demo-embedded', PUBLIC_VALUE='visible', FINN_NUMBER=17)\n`);
          const output = python(['-m', 'flask', '--app', 'finn_demo_app:app', 'config'], { PYTHONPATH: [fixture, join(repo, 'src')].join(delimiter) });
          return validateMaskedConfig(output);
        } finally { rmSync(fixture, { recursive: true, force: true }); }
      });
    }
  }
  const result = { task: flags.task, repo, commit: current.commit, checkedAt: new Date().toISOString(), passed: checks.every(item => item.passed), checks, scope: 'Mechanical verification only; agent execution, review, streaming, cancellation, UI responsiveness and TrueForge session require separate recording.' };
  save(result);
  if (!result.passed) process.exitCode = 1;
  console.log(JSON.stringify({ task: result.task, passed: result.passed, scope: result.scope }, null, 2));
  return result;
}

export function validateMaskedConfig(output) {
  let config;
  try { config = JSON.parse(output); } catch { throw new Error('flask config must emit valid JSON without extra stdout text'); }
  if (!config || Array.isArray(config) || typeof config !== 'object') throw new Error('Expected a JSON object');
  for (const key of ['SECRET_KEY', 'DATABASE_PASSWORD', 'ACCESS_TOKEN', 'API_KEY', 'PREFIX_SECRET_SUFFIX']) {
    if (config[key] !== '***') throw new Error(`${key} must be present and masked as "***"`);
  }
  for (const [key, value] of Object.entries(config)) {
    if (/SECRET|PASSWORD|TOKEN|KEY/i.test(key) && value !== '***') throw new Error(`${key} leaked an unmasked value`);
  }
  if (config.PUBLIC_VALUE !== 'visible' || config.FINN_NUMBER !== 17) throw new Error('Non-sensitive values must retain their JSON values');
  return config;
}

export function validateHelp(output) {
  if (!/^\s+config(?:\s|$)/m.test(output)) throw new Error('flask --help does not list the built-in config command');
  return true;
}

export function validateTaskBFiles(files) {
  const unique = [...new Set(files)];
  if (unique.length < 3) throw new Error(`Task B needs at least three distinct edited files since its baseline; found ${unique.length}`);
  for (const prefix of ['src/', 'tests/', 'docs/']) {
    if (!unique.some(path => path.startsWith(prefix))) throw new Error(`Task B requires an edited ${prefix} file (implementation, tests, built-in command documentation)`);
  }
  return true;
}

export function validateCleanSnapshot(before, after) {
  if (before.status !== '') throw new Error('Task C baseline must have a clean git status');
  if (after.status !== '' || before.repo !== after.repo || before.commit !== after.commit || JSON.stringify(before.files) !== JSON.stringify(after.files)) throw new Error('Task C workspace changed; keep this evidence and investigate. No reset was performed.');
  return true;
}

export const DEBUG_CASES = { off: false, OFF: false, oFf: false, n: false, N: false, '0': false, false: false, FaLsE: false, no: false, NO: false, '': false, '1': true, yes: true, on: true };

export function validateDebugFlags(observations) {
  for (const [value, expected] of Object.entries(DEBUG_CASES)) {
    if (!(value in observations)) throw new Error(`Missing FLASK_DEBUG case ${JSON.stringify(value)}`);
    if (observations[value] !== expected) throw new Error(`FLASK_DEBUG=${JSON.stringify(value)} expected ${expected}, got ${observations[value]}. Perform Task A through Finn and accept its reviewed diff first.`);
  }
  return true;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`Demo verification failed: ${error.message}`); process.exitCode = 1; }
}
