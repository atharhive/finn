import { describe, expect, it } from 'vitest';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const moduleUrl = pathToFileURL(resolve('scripts/start-trueforge.mjs')).href;
describe('local TrueForge launcher', () => {
  it('allows only the local editor bridge without disabling outbound protection', async () => {
    const { localEnvironment } = await import(moduleUrl);
    const env = localEnvironment({ PATH: '/bin', NETWORK_POLICY_ENABLED: 'false', HOST: '0.0.0.0' });
    expect(env.HOST).toBe('127.0.0.1');
    expect(env.STANDALONE).toBe('true');
    expect(env.NETWORK_POLICY_ENABLED).toBe('true');
    expect(JSON.parse(env.OUTBOUND_URL_ALLOWED_HOSTS)).toEqual(['127.0.0.1', 'localhost']);
    expect(env.PATH).toBe('/bin');
  });
});
