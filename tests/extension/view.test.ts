import { expect, it } from 'vitest';
import { Script } from 'node:vm';
import { renderWebview, escapeHtml } from '../../src/extension/view.js';

it('renders a theme-native accessible shell with a closed CSP and no untrusted HTML sinks', () => {
  const html = renderWebview('test-nonce');
  const script = html.match(/<script nonce="test-nonce">([\s\S]*?)<\/script>/)?.[1];
  expect(script).toBeDefined();
  expect(() => new Script(script!)).not.toThrow();
  expect(html).toContain("default-src 'none'");
  expect(html).toContain("script-src 'nonce-test-nonce'");
  expect(html).toContain('nonce="test-nonce"');
  expect(html).toContain('var(--vscode-editor-background)');
  expect(html).toContain('aria-live="polite"');
  expect(html).toContain('Accept hunk');
  expect(html).toContain('textContent');
  expect(html).not.toContain('innerHTML');
  expect(html).not.toMatch(/https?:\/\//);
  expect(escapeHtml('<img src=x onerror="x">&')).toBe('&lt;img src=x onerror=&quot;x&quot;&gt;&amp;');
});
