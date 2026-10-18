import { describe, expect, it } from 'vitest';

import { hasRepetitiveAiOutput } from './aiSummaryOutput';

describe('AI summary output loops', () => {
  it.each(['morning time, ', '早上好', '🌅'])('rejects sustained %s repetition', (phrase) => {
    expect(hasRepetitiveAiOutput(`Morning check-ins: ${phrase.repeat(80)}`)).toBe(true);
  });

  it('rejects repeated long sentences even when callsigns separate them', () => {
    const text = Array.from(
      { length: 6 },
      (_, index) => `Node ${index}: Hello. I hope everyone had a good day.`,
    ).join('\n');
    expect(hasRepetitiveAiOutput(text)).toBe(true);
  });

  it('allows useful callsign reuse, short laughter, public keys and distinct facts', () => {
    const text = [
      'W0AIR reports East repeater working.',
      'W0AIR asks whether West repeater is offline.',
      'N0ZAP heard W0AIR through East, 2 hops.',
      'K0FIX will check West at noon; no repair is confirmed.',
      'W0AIR plans to join the net at 20:00.',
      '哈哈哈哈 😄😄😄',
      'ab'.repeat(32),
    ].join('\n');
    expect(hasRepetitiveAiOutput(text)).toBe(false);
  });

  it('detects a loop before a trailing non-repeated sentence in one chunk', () => {
    expect(hasRepetitiveAiOutput(`${'morning time, '.repeat(12)}Have a good day.`)).toBe(true);
  });
});
