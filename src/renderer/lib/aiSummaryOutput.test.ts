import { describe, expect, it } from 'vitest';

import {
  dedupeAiSummaryOneOffs,
  finalizeAiSummaryText,
  hasRepetitiveAiOutput,
  sanitizeAiModelOutput,
} from './aiSummaryOutput';

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

describe('AI summary output sanitize and dedupe', () => {
  it('strips /no_think echoes', () => {
    expect(sanitizeAiModelOutput('Half Live suggested 2-byte addresses.\n/no_think')).toBe(
      'Half Live suggested 2-byte addresses.',
    );
    expect(sanitizeAiModelOutput('/no_think')).toBe('');
  });

  it('treats a lone /no_think as empty after finalize', () => {
    expect(finalizeAiSummaryText('  /no_think  ')).toBe('');
  });

  it('returns the original text when no One-off was removed', () => {
    const text = [
      'Conversations:',
      '- Half Live: suggested changing to 2-byte addresses.',
      '',
      'One-offs:',
      '- KE4IQR-1: sent a greeting to Evans.',
    ].join('\n');
    expect(dedupeAiSummaryOneOffs(text)).toBe(text);
  });

  it('drops near-duplicate One-offs while preserving Conversations lines', () => {
    const text = [
      'Conversations:',
      '  - Half Live: suggested changing to 2-byte addresses for routing and usage stats.',
      '',
      'One-offs:',
      '- KE4IQR-1: sent a greeting to Evans.',
      '- KC0SIQ-03: shared their morning coffee routine of catching up.',
      '- HYPERSPACE PRIM: mentioned receiving a new t114 to help troubleshoot a repeater power issue.',
      '- KE4IQR-1: KE4IQR-1 sent a greeting to Evans.',
      '- KC0SIQ-03: KC0SIQ-03 shared their morning coffee routine of catching up.',
      '- HYPERSPACE PRIM: HYPERSPACE PRIM mentioned receiving a new t114 to help troubleshoot a repeater power issue.',
    ].join('\n');
    const deduped = dedupeAiSummaryOneOffs(text);
    expect(deduped).toContain(
      '  - Half Live: suggested changing to 2-byte addresses for routing and usage stats.',
    );
    expect(deduped).toContain('- KE4IQR-1: sent a greeting to Evans.');
    expect(deduped).toContain('- KC0SIQ-03: shared their morning coffee routine of catching up.');
    expect(deduped).toContain(
      '- HYPERSPACE PRIM: mentioned receiving a new t114 to help troubleshoot a repeater power issue.',
    );
    expect(deduped).not.toContain('KE4IQR-1: KE4IQR-1 sent a greeting');
    expect(deduped.match(/KE4IQR-1:/g)?.length).toBe(1);
    expect(deduped.match(/KC0SIQ-03:/g)?.length).toBe(1);
    expect(deduped.match(/HYPERSPACE PRIM:/g)?.length).toBe(1);
  });
});
