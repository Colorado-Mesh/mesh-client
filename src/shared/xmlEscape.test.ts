import { describe, expect, it } from 'vitest';

import { escapeXml, escapeXmlAttr, escapeXmlText } from './xmlEscape';

describe('escapeXml', () => {
  it('escapes all five entities in order, ampersand first', () => {
    expect(escapeXml('a & b < c > d " e \' f')).toBe('a &amp; b &lt; c &gt; d &quot; e &apos; f');
  });

  it('leaves plain text untouched', () => {
    expect(escapeXml('hello world')).toBe('hello world');
    expect(escapeXml('')).toBe('');
  });
});

describe('escapeXmlAttr', () => {
  it('escapes amp, quote, lt, gt but not apostrophe', () => {
    expect(escapeXmlAttr('a & b " c < d > e')).toBe('a &amp; b &quot; c &lt; d &gt; e');
    expect(escapeXmlAttr("it's fine")).toBe("it's fine");
  });
});

describe('escapeXmlText', () => {
  it('escapes amp, lt, gt but leaves quotes', () => {
    expect(escapeXmlText('a & b " c < d > e')).toBe('a &amp; b " c &lt; d &gt; e');
  });
});
