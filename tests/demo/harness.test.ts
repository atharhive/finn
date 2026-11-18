import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import * as prepare from '../../scripts/prepare-demo.mjs';

describe('pinned demo preparation', () => {
  it('places uv interpreter selection after pip subcommands', () => {
    expect(prepare.pythonInstallCommand('/venv/python', '/flask', true)).toEqual(['uv', ['pip', 'install', '--python', '/venv/python', '-e', '/flask', 'pytest>=8,<9', 'asgiref>=3.2', 'python-dotenv>=1']]);
    expect(prepare.pythonInstallCommand('/venv/python', '/flask', false)[0]).toBe('/venv/python');
  });
  it('offers CLI help and never overwrites an existing demo directory', () => {
    const help = spawnSync(process.execPath, ['scripts/prepare-demo.mjs', '--help'], { encoding: 'utf8' });
    expect(help.stdout).toContain('--dir');
    const dir = mkdtempSync(join(tmpdir(), 'finn-demo-test-'));
    try {
      const result = spawnSync(process.execPath, ['scripts/prepare-demo.mjs', '--dir', dir], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('already exists');
    } finally { rmSync(dir, { recursive: true }); }
  });
  it('parses explicit CLI flags and rejects missing or unknown values', () => {
    expect(prepare.parseArgs(['--dir', '/some folder', '--skip-tests'], { dir: 'value', 'skip-tests': 'boolean' })).toEqual({ dir: '/some folder', 'skip-tests': true });
    expect(() => prepare.parseArgs(['--dir'], { dir: 'value' })).toThrow(/value/);
    expect(() => prepare.parseArgs(['--force'], {})).toThrow(/Unknown/);
  });
  it('executes real commands and surfaces actionable nonzero errors', () => {
    expect(prepare.run(process.execPath, ['-e', 'process.stdout.write("real")'], { quiet: true }).trim()).toBe('real');
    expect(() => prepare.run(process.execPath, ['-e', 'process.stderr.write("missing model"); process.exit(7)'], { quiet: true })).toThrow(/7.*missing model/s);
  });
  it('requires the official tag commit and refuses lookalike prefixes', () => {
    expect(prepare.validateRevision('22d92470' + '0'.repeat(32))).toBe('22d92470' + '0'.repeat(32));
    expect(() => prepare.validateRevision('22d92470')).toThrow(/40/);
    expect(() => prepare.validateRevision('b'.repeat(40))).toThrow(/22d92470/);
  });
});
