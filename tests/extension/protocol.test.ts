import { describe, expect, it } from 'vitest';
import { parseMessage } from '../../src/extension/protocol.js';

describe('webview boundary', () => {
  it('accepts a bounded task and rejects unexpected payloads', () => {
    expect(parseMessage({ type: 'run', prompt: 'Explain this module' })).toEqual({ type: 'run', prompt: 'Explain this module' });
    const malformed = { type: Object.create(null) };
    expect(() => parseMessage(malformed)).not.toThrow();
    expect(parseMessage(malformed)).toBeUndefined();
    for (const value of [null, [], { type: 'run', prompt: '' }, { type: 'run', prompt: 'a'.repeat(32001) }, { type: 'run', prompt: 'ok', command: 'evil' }, { type: 'execute', command: 'sh' }]) {
      expect(parseMessage(value)).toBeUndefined();
    }
  });
});
