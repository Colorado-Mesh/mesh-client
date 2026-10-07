import { describe, expect, it } from 'vitest';

import { escapeXml, escapeXmlAttr, escapeXmlText } from './xmlEscape';

describe('xmlEscape', () => {
  describe('escapeXml', () => {
    it('escapes all standard XML entities (&, <, >, ", \')', () => {
      expect(escapeXml('Tom & Jerry <"classic\'>')).toBe(
        'Tom &amp; Jerry &lt;&quot;classic&apos;&gt;',
      );
    });

    it('leaves plain text unchanged', () => {
      expect(escapeXml('plain text 123')).toBe('plain text 123');
      expect(escapeXml('')).toBe('');
    });

    it('escapes multiple occurrences in correct order', () => {
      expect(escapeXml('&&<<>>""\'\'')).toBe('&amp;&amp;&lt;&lt;&gt;&gt;&quot;&quot;&apos;&apos;');
    });
  });

  describe('escapeXmlAttr', () => {
    it('escapes attribute-sensitive characters (&, ", <, >) without touching single quotes', () => {
      expect(escapeXmlAttr('<div attr="foo & \'bar\'">')).toBe(
        "&lt;div attr=&quot;foo &amp; 'bar'&quot;&gt;",
      );
    });

    it('leaves single quotes unmodified', () => {
      expect(escapeXmlAttr("It's a test")).toBe("It's a test");
    });
  });

  describe('escapeXmlText', () => {
    it('escapes only text delimiters (&, <, >) and preserves quotes', () => {
      expect(escapeXmlText('Hello "world" & \'friends\' <tag>')).toBe(
        'Hello "world" &amp; \'friends\' &lt;tag&gt;',
      );
    });
  });
});
