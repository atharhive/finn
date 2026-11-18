import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AgentSpec, ModelProviderManifest } from '@truefoundry/trueforge-sdk/serialization';
import { FINN_INSTRUCTIONS } from '../../src/agent/index.js';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../examples/${name}`, import.meta.url), 'utf8'));
describe('TrueForge 0.185.0 example schemas', () => {
  it('validates the SDK-shaped agent definition against the installed serializer', async () => {
    const spec = read('finn-agent.sdk.json');
    const result = await AgentSpec.json(spec, { unrecognizedObjectKeys: 'fail' });
    expect(result.ok).toBe(true);
    expect(spec.instructions).toBe(FINN_INSTRUCTIONS);
    expect(spec.mcpServers[0].enableTools).toContain('propose_edit');
  });
  it('validates local model and unreachable Task C provider manifests', async () => {
    for (const name of ['model-provider.sdk.json', 'task-c-provider.sdk.json']) {
      const result = await ModelProviderManifest.json(read(name), { unrecognizedObjectKeys: 'fail' });
      expect(result.ok).toBe(true);
    }
  });
});
