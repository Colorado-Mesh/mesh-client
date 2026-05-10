// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildWindowsAboutDocumentHtml, escapeHtmlText } from './windows-about-html';

describe('windows-about-html', () => {
  it('escapes HTML metacharacters in user-visible strings', () => {
    expect(escapeHtmlText('a & b')).toBe('a &amp; b');
    expect(escapeHtmlText('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtmlText('say "hi"')).toBe('say &quot;hi&quot;');
  });

  it('builds a document with escaped title/version, action buttons, and https links', () => {
    const html = buildWindowsAboutDocumentHtml('Test<&>App', '1.2.3');
    expect(html).toContain('Test&lt;&amp;&gt;App');
    expect(html).toContain('1.2.3');
    expect(html).toContain('class="action-btn"');
    expect(html).toContain('>Website</a>');
    expect(html).toContain('>GitHub</a>');
    expect(html).toContain('>Discord</a>');
    expect(html).toContain('>Close</button>');
    expect(html).toContain('href="https://coloradomesh.org/"');
    expect(html).toContain('href="https://github.com/Colorado-Mesh/mesh-client"');
    expect(html).toContain('href="https://discord.com/invite/McChKR5NpS"');
    expect(html).toContain('aria-label="Close About window"');
    expect(html).not.toContain('<script');
  });
});
