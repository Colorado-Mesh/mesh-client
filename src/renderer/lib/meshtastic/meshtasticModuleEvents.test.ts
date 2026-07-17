import { describe, expect, it } from 'vitest';

import {
  appendModulePortEvent,
  appendPaxHistory,
  computeRangeTestLossRate,
  decodeModulePortText,
  MAX_MODULE_EVENT_POINTS,
  MAX_PAX_HISTORY_POINTS,
  type ModulePortEvent,
  parseRangeTestPayload,
} from './meshtasticModuleEvents';

describe('meshtasticModuleEvents', () => {
  it('decodes printable UTF-8 module payloads', () => {
    expect(decodeModulePortText(new TextEncoder().encode('hello'))).toBe('hello');
    expect(decodeModulePortText(new Uint8Array([0, 1, 2, 3, 4]))).toBeUndefined();
  });

  it('parses range test text fields', () => {
    const decoded = parseRangeTestPayload(new TextEncoder().encode('seq=3 snr=4.5 rssi=-72'));
    expect(decoded.sequence).toBe(3);
    expect(decoded.snr).toBe(4.5);
    expect(decoded.rssi).toBe(-72);
  });

  it('computes loss rate from sequence gaps', () => {
    const events = [1, 2, 4].map((sequence, i) => ({
      from: 1,
      data: new TextEncoder().encode(`seq=${sequence}`),
      timestamp: i,
    }));
    expect(computeRangeTestLossRate(events)).toBeCloseTo(0.25);
  });

  it('caps pax history and module events', () => {
    let pax = new Map<number, { from: number; count: number; timestamp: number }[]>();
    for (let i = 0; i < MAX_PAX_HISTORY_POINTS + 10; i++) {
      pax = appendPaxHistory(pax, { from: 7, count: i, timestamp: i });
    }
    expect(pax.get(7)?.length).toBe(MAX_PAX_HISTORY_POINTS);
    expect(pax.get(7)?.[0]?.count).toBe(10);

    let events = new Map<number, ModulePortEvent[]>();
    for (let i = 0; i < MAX_MODULE_EVENT_POINTS + 5; i++) {
      events = appendModulePortEvent(events, {
        from: 9,
        data: new TextEncoder().encode(`e${i}`),
        timestamp: i,
      });
    }
    expect(events.get(9)?.length).toBe(MAX_MODULE_EVENT_POINTS);
    expect(events.get(9)?.[0]?.text).toBe('e5');
  });
});
