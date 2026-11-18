import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import * as verify from '../../scripts/verify-demo.mjs';

describe('actual demo output validation', () => {
  it('rejects output paths inside either checkout including dot-prefixed subdirectories', () => {
    expect(verify.validateOutputPath('/demo/result.json', ['/demo/flask', '/demo/flask-c'])).toBe('/demo/result.json');
    expect(() => verify.validateOutputPath('/demo/flask/..hidden/result.json', ['/demo/flask'])).toThrow(/outside/);
    expect(() => verify.validateOutputPath('/demo/flask', ['/demo/flask'])).toThrow(/outside/);
  });
  it('counts actual content changes after the Task B snapshot, not prior Task A edits', () => {
    expect(verify.changedFiles({ helper: 'a', cli: 'a' }, { helper: 'a', cli: 'b', test: 'c' })).toEqual(['cli', 'test']);
    expect(verify.changedFiles({ deleted: 'a' }, {})).toEqual(['deleted']);
  });
  it('exposes CLI modes and rejects missing preparation metadata', () => {
    const help = spawnSync(process.execPath, ['scripts/verify-demo.mjs', '--help'], { encoding: 'utf8' });
    expect(help.stdout).toContain('snapshot-c');
    const invalid = spawnSync(process.execPath, ['scripts/verify-demo.mjs', '--task', 'a'], { encoding: 'utf8' });
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('--dir');
  });
  it('rejects invalid JSON, missing fields, leaked values and missing help command', () => {
    const config = { SECRET_KEY: '***', DATABASE_PASSWORD: '***', ACCESS_TOKEN: '***', API_KEY: '***', PREFIX_SECRET_SUFFIX: '***', PUBLIC_VALUE: 'visible', FINN_NUMBER: 17 };
    expect(verify.validateMaskedConfig(JSON.stringify(config))).toEqual(config);
    expect(() => verify.validateMaskedConfig('noise\n' + JSON.stringify(config))).toThrow(/JSON/);
    expect(() => verify.validateMaskedConfig(JSON.stringify({ ...config, ACCESS_TOKEN: 'leaked' }))).toThrow(/ACCESS_TOKEN/);
    expect(() => verify.validateMaskedConfig('{}')).toThrow(/SECRET_KEY/);
    expect(verify.validateHelp('Commands:\n  config  Print config.\n  run')).toBe(true);
    expect(() => verify.validateHelp('Use config in your app')).toThrow(/--help/);
  });
  it('requires three distinct Task B edits including implementation, tests and documentation', () => {
    expect(verify.validateTaskBFiles(['src/flask/cli.py', 'tests/test_cli.py', 'docs/cli.rst'])).toBe(true);
    expect(() => verify.validateTaskBFiles(['a', 'a', 'b'])).toThrow(/three/i);
    expect(() => verify.validateTaskBFiles(['src/flask/cli.py', 'tests/test_cli.py', 'README.md'])).toThrow(/docs/);
  });
  it('compares C snapshots strictly and rejects dirty baseline evidence', () => {
    const before = { repo: '/clean', commit: 'sha', status: '', files: { 'src/a': 'abc' } };
    expect(verify.validateCleanSnapshot(before, structuredClone(before))).toBe(true);
    expect(() => verify.validateCleanSnapshot(before, { ...before, status: ' M src/a' })).toThrow(/changed/);
    expect(() => verify.validateCleanSnapshot({ ...before, status: ' M src/a' }, before)).toThrow(/baseline/i);
    expect(() => verify.validateCleanSnapshot(before, { ...before, files: { 'src/a': 'def' } })).toThrow(/changed/);
  });
  it('requires false for off/n mixed cases and retains truthy behaviour', () => {
    const observations = { off: false, OFF: false, oFf: false, n: false, N: false, '0': false, false: false, FaLsE: false, no: false, NO: false, '': false, '1': true, yes: true, on: true };
    expect(verify.validateDebugFlags(observations)).toBe(true);
    expect(() => verify.validateDebugFlags({ ...observations, oFf: true })).toThrow(/oFf/);
    expect(() => verify.validateDebugFlags({ off: false })).toThrow(/missing/i);
  });
});
