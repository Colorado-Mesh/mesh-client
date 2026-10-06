import { describe, expect, it } from 'vitest';

import { escapeSvgAttr, escapeSvgText } from './escapeSvg';

describe('escapeSvg', () => {
  it('escapes SVG attribute content properly', () => {
    expect(escapeSvgAttr('blue & "gold" <circle>')).toBe(
      'blue &amp; &quot;gold&quot; &lt;circle&gt;',
    );
  });

  it('escapes SVG text content properly', () => {
    expect(escapeSvgText('Signal > 50% & clean')).toBe('Signal &gt; 50% &amp; clean');
  });
});
