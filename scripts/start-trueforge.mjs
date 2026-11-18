import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Local editor MCP needs an explicit loopback exception in TrueForge 0.185. */
export function localEnvironment(environment = process.env) {
  return {
    ...environment,
    HOST: '127.0.0.1',
    STANDALONE: 'true',
    NETWORK_POLICY_ENABLED: 'true',
    OUTBOUND_URL_ALLOWED_HOSTS: JSON.stringify(['127.0.0.1', 'localhost']),
  };
}

export function startTrueForge(args = process.argv.slice(2)) {
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const prefix = npmCli ? [npmCli, 'exec', '--yes', '--package=@truefoundry/trueforge@0.185.0', '--', 'trueforge'] : ['--yes', '--package=@truefoundry/trueforge@0.185.0', 'trueforge'];
  const child = spawn(command, [...prefix, ...args], { env: localEnvironment(), stdio: 'inherit', shell: false });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  child.once('error', error => { console.error(`Could not start TrueForge: ${error.message}`); process.exitCode = 1; });
  child.once('exit', code => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.exitCode = code ?? 1;
  });
  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) startTrueForge();
