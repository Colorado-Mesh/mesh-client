import { describe, expect, it } from 'vitest';

import en from '../locales/en/translation.json';
import { tryParseMecp } from './mecp/mecpMessages';
import {
  DEFAULT_QUICK_STATUS_PRESETS,
  formatQuickStatusPayload,
  type QuickStatusPreset,
} from './quickStatusMessages';

function preset(id: string): QuickStatusPreset {
  const found = DEFAULT_QUICK_STATUS_PRESETS.find((p) => p.id === id);
  if (!found) throw new Error(`missing preset ${id}`);
  return found;
}

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      en,
    );
}

describe('DEFAULT_QUICK_STATUS_PRESETS', () => {
  it('has the five default presets with unique ids', () => {
    expect(DEFAULT_QUICK_STATUS_PRESETS.map((p) => p.text)).toEqual([
      'OK',
      'Need help',
      'In position',
      'Lost comms',
      'Returning',
    ]);
    expect(new Set(DEFAULT_QUICK_STATUS_PRESETS.map((p) => p.id)).size).toBe(5);
  });

  it('has an English translation for every label key', () => {
    for (const p of DEFAULT_QUICK_STATUS_PRESETS) {
      expect(typeof lookup(p.labelKey)).toBe('string');
    }
  });
});

describe('formatQuickStatusPayload', () => {
  it('returns plain text by default', () => {
    expect(formatQuickStatusPayload(preset('ok'))).toBe('OK');
  });

  it('appends coordinates when both are valid', () => {
    expect(formatQuickStatusPayload(preset('inPosition'), { lat: 39.7392, lon: -104.9903 })).toBe(
      'In position 39.73920,-104.99030',
    );
  });

  it('omits invalid, partial, or null-island coordinates', () => {
    expect(formatQuickStatusPayload(preset('ok'), { lat: 39.7 })).toBe('OK');
    expect(formatQuickStatusPayload(preset('ok'), { lat: NaN, lon: 1 })).toBe('OK');
    expect(formatQuickStatusPayload(preset('ok'), { lat: 91, lon: 1 })).toBe('OK');
    expect(formatQuickStatusPayload(preset('ok'), { lat: 0, lon: 0 })).toBe('OK');
  });

  it('encodes MECP with default routine severity', () => {
    const wire = formatQuickStatusPayload(preset('needHelp'), { asMecp: true });
    expect(wire).toBe('MECP/3/C01 Need help');
    expect(tryParseMecp(wire)?.severity).toBe(3);
  });

  it('encodes MECP with explicit severity and coordinates', () => {
    const wire = formatQuickStatusPayload(preset('needHelp'), {
      asMecp: true,
      severity: 1,
      lat: 40,
      lon: -105,
    });
    expect(wire).toBe('MECP/1/C01 Need help 40.00000,-105.00000');
    expect(tryParseMecp(wire)?.codes).toEqual(['C01']);
  });

  it('falls back to plain text when the preset has no MECP codes', () => {
    expect(formatQuickStatusPayload(preset('lostComms'), { asMecp: true })).toBe('Lost comms');
  });
});
