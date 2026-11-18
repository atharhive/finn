import { spawn } from 'node:child_process';
import type { CommandRequest } from '../contracts.js';

export interface CommandResult { stdout: string; stderr: string; exitCode: number | null; truncated: boolean }

/** Await an external approval without letting a stalled UI defeat cancellation. */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new Error('Command cancelled')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export function executeCommand(request: CommandRequest, cwd: string, signal: AbortSignal): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(request.command, request.args, {
      cwd, shell: false, detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { PATH: process.env.PATH, HOME: cwd, LANG: 'C.UTF-8', CI: '1' },
    });
    const stdout: Buffer[] = []; const stderr: Buffer[] = [];
    let bytes = 0; let truncated = false;
    const kill = () => {
      try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* Already exited. */ }
    };
    signal.addEventListener('abort', kill, { once: true });
    const collect = (chunks: Buffer[], chunk: Buffer) => {
      const remaining = Math.max(0, 65536 - bytes);
      chunks.push(chunk.subarray(0, remaining)); bytes += Math.min(remaining, chunk.length);
      if (chunk.length > remaining) { truncated = true; kill(); }
    };
    child.stdout.on('data', (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on('data', (chunk: Buffer) => collect(stderr, chunk));
    child.once('error', error => { signal.removeEventListener('abort', kill); reject(error); });
    child.once('close', code => {
      signal.removeEventListener('abort', kill);
      if (signal.aborted) reject(signal.reason ?? new Error('Command cancelled'));
      else resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode: code, truncated });
    });
    if (signal.aborted) kill();
  });
}
