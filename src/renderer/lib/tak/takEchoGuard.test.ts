import { beforeEach, describe, expect, it } from 'vitest';

import { consumeTakEcho, rememberTakSend, resetTakEchoForTests } from './takEchoGuard';

const NOW = Date.parse('2026-10-11T12:00:00Z');

describe('takEchoGuard', () => {
  beforeEach(() => {
    resetTakEchoForTests();
  });

  it('matches a remembered send once, on the same identity and channel', () => {
    rememberTakSend('a', 2, '[VIPER] on scene', NOW);
    expect(consumeTakEcho('b', 2, '[VIPER] on scene', NOW)).toBe(false);
    expect(consumeTakEcho('a', 3, '[VIPER] on scene', NOW)).toBe(false);
    expect(consumeTakEcho('a', 2, '[VIPER] other', NOW)).toBe(false);
    expect(consumeTakEcho('a', 2, ' [VIPER] on scene ', NOW + 1000)).toBe(true);
    expect(consumeTakEcho('a', 2, '[VIPER] on scene', NOW + 2000)).toBe(false);
  });

  it('counts the same text sent twice as two echoes', () => {
    rememberTakSend('a', 2, '[VIPER] copy', NOW);
    rememberTakSend('a', 2, '[VIPER] copy', NOW + 10);
    expect(consumeTakEcho('a', 2, '[VIPER] copy', NOW + 20)).toBe(true);
    expect(consumeTakEcho('a', 2, '[VIPER] copy', NOW + 30)).toBe(true);
    expect(consumeTakEcho('a', 2, '[VIPER] copy', NOW + 40)).toBe(false);
  });

  it('forgets a send after the echo window', () => {
    rememberTakSend('a', 2, '[VIPER] late', NOW);
    expect(consumeTakEcho('a', 2, '[VIPER] late', NOW + 3 * 60_000)).toBe(false);
  });

  it('keeps a bounded number of entries', () => {
    for (let i = 0; i < 100; i++) rememberTakSend('a', 2, `m${i}`, NOW + i);
    expect(consumeTakEcho('a', 2, 'm0', NOW + 200)).toBe(false);
    expect(consumeTakEcho('a', 2, 'm99', NOW + 200)).toBe(true);
  });
});
