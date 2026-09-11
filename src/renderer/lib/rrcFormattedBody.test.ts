import { describe, expect, it } from 'vitest';

import { lightMarkdownToMicron, rrcBodyLooksFormatted } from './rrcFormattedBody';

describe('rrcFormattedBody', () => {
  it('detects micron and markdown cues', () => {
    expect(rrcBodyLooksFormatted('plain hello')).toBe(false);
    expect(rrcBodyLooksFormatted('`!Bold`!')).toBe(true);
    expect(rrcBodyLooksFormatted('**bold**')).toBe(true);
    expect(rrcBodyLooksFormatted('[x](https://example.com)')).toBe(true);
  });

  it('maps light markdown to micron controls', () => {
    expect(lightMarkdownToMicron('**Hi**')).toContain('`!Hi`!');
    expect(lightMarkdownToMicron('*Hi*')).toContain('`*Hi`*');
    expect(lightMarkdownToMicron('[Docs](https://example.com)')).toBe(
      '`[Docs`https://example.com`]',
    );
  });

  it('keeps emphasis markers inside markdown link destinations', () => {
    expect(lightMarkdownToMicron('[x](https://example.com/foo__bar__baz)')).toBe(
      '`[x`https://example.com/foo__bar__baz`]',
    );
    expect(lightMarkdownToMicron('[*lab*](https://example.com/a_b)')).toBe(
      '`[`*lab`*`https://example.com/a_b`]',
    );
  });

  it('routes markdown bodies through micron conversion before render', () => {
    // Full HTML render needs jsdom (MicronParser); this asserts the preprocess path.
    expect(rrcBodyLooksFormatted('see **bold**')).toBe(true);
    expect(lightMarkdownToMicron('see **bold**')).toContain('`!bold`!');
  });
});
