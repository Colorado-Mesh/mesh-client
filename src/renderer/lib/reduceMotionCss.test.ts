import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf8');

describe('Reduce motion (styles.css)', () => {
  it('stops decorative pulses app-wide when the setting is on', () => {
    expect(CSS).toMatch(
      /html\[data-reduce-motion='true'\] \.animate-pulse:not\(\.motion-status\),[\s\S]*?\.animate-ping:not\(\.motion-status\),[\s\S]*?\.animate-bounce:not\(\.motion-status\)\s*\{\s*animation: none !important;/,
    );
  });

  it('marks status pulses so they keep moving', async () => {
    const { CONNECTION_HEADER_PULSE_RED_DOT, CONNECTION_HEADER_WARN_DOT, ROOM_LOGIN_PROGRESS_DOT } =
      await import('./connectionHeaderStatus');
    for (const cls of [
      CONNECTION_HEADER_PULSE_RED_DOT,
      CONNECTION_HEADER_WARN_DOT,
      ROOM_LOGIN_PROGRESS_DOT,
    ]) {
      expect(cls).toContain('motion-status');
    }
  });

  it('shortens transitions and smooth scrolling but leaves spinners alone', () => {
    expect(CSS).toMatch(/transition-duration: 0\.01ms !important;/);
    expect(CSS).toMatch(/scroll-behavior: auto !important;/);
    expect(CSS).not.toMatch(/data-reduce-motion='true'\] \.animate-spin/);
  });
});
