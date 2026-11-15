/**
 * MECP 1.3.0 freetext conformance — mirrors mecp-org/MECP scripts/check-freetext.mjs
 * against vendored freetext/tests.json and patterns.json.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { decode } from './decoder';
import patterns from './freetext/patterns.json';
import tests from './freetext/tests.json';
import {
  extractFreetextConventions,
  matchMessageEnvelope,
  MESSAGE_ENVELOPE_RE,
} from './freetextExtract';

const ROOT = dirname(fileURLToPath(import.meta.url));

interface FreetextTestCase {
  convention: string;
  input: string;
  expect: Record<string, unknown>;
}

const CASES = tests as FreetextTestCase[];

function conventionResult(
  convention: string,
  freetext: string,
  codes: string[],
): Record<string, unknown> {
  const extracted = extractFreetextConventions(freetext, codes);
  switch (convention) {
    case 'timestamp':
      return extracted.timestamp != null ? { timestamp: extracted.timestamp } : {};
    case 'reference':
      return extracted.reference != null ? { reference: extracted.reference } : {};
    case 'pax':
      return extracted.count != null ? { pax: extracted.count } : {};
    case 'gps':
      return extracted.gps != null ? { gps: extracted.gps } : {};
    case 'callsign':
      return extracted.callsign != null ? { callsign: extracted.callsign } : {};
    case 'language':
      return extracted.language != null ? { language: extracted.language } : {};
    case 'duration':
      return extracted.duration != null ? { duration: extracted.duration } : {};
    default:
      throw new Error(`unknown convention ${convention}`);
  }
}

describe('MECP 1.3.0 freetext patterns fixture', () => {
  it('keeps every pattern string loadable from patterns.json', () => {
    expect(typeof patterns.message.decode).toBe('string');
    expect(MESSAGE_ENVELOPE_RE.test('MECP/1/T05')).toBe(true);
    expect(MESSAGE_ENVELOPE_RE.test('MECP/1/T05 ')).toBe(false);
    expect(patterns.duration.scope).toBe('R03');
    expect(Array.isArray(patterns.duration.decode)).toBe(true);
  });

  it('vendors tests.json beside patterns.json', () => {
    const raw = readFileSync(join(ROOT, 'freetext/tests.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(tests);
  });
});

describe('MECP 1.3.0 freetext conformance (upstream tests.json)', () => {
  it.each(CASES)('$convention — $input', (t) => {
    if (t.convention === 'message') {
      const got = { valid: matchMessageEnvelope(t.input) != null };
      expect(got).toEqual(t.expect);
      return;
    }
    const env = matchMessageEnvelope(t.input);
    expect(env, `envelope failed for ${t.input}`).not.toBeNull();
    const got = conventionResult(t.convention, env!.freetext, env!.codes);
    expect(got).toEqual(t.expect);
  });

  it('uses strict duration encode patterns without spaces before units (1.3.0)', () => {
    for (const pat of patterns.duration.encode) {
      expect(pat).not.toMatch(/ \?/);
      expect(pat).not.toContain(' ?');
    }
  });

  it('decode() still accepts spaced duration tokens on ingest', () => {
    expect(decode('MECP/2/R03 45 min').extracted.duration).toBe(45);
    expect(decode('MECP/2/R03 ETA 1h 30min').extracted.duration).toBe(90);
  });

  it('decode() surfaces the same duration/callsign/reference extractions', () => {
    const duration = decode('MECP/2/R03 45min');
    expect(duration.extracted.duration).toBe(45);
    expect(duration.extracted.durationToken).toBe('45min');
    expect(decode('MECP/3/L06 45min').extracted.duration).toBeNull();

    // #28: any SI unit, no 1440-minute upper bound
    expect(decode('MECP/2/R03 2d').extracted.duration).toBe(2880);
    expect(decode('MECP/2/R03 48h').extracted.duration).toBe(2880);
    expect(decode('MECP/2/R03 2880min').extracted.duration).toBe(2880);

    const cs = decode('MECP/3/L20 ~DL/OK1ABC');
    expect(cs.extracted.callsign).toBe('DL/OK1ABC');

    const ref = decode('MECP/2/C08 #base-camp,');
    expect(ref.extracted.reference).toBe('base-camp');

    const ts = decode('MECP/3/L06 @2460 @1400 @1530');
    expect(ts.extracted.timestamp).toBe('14:00');
  });

  it('rejects 0s so a later positive seconds duration can match', () => {
    const parsed = decode('MECP/2/R03 0s 7200s');
    expect(parsed.extracted.duration).toBe(120);
    expect(parsed.extracted.durationToken).toBe('7200s');
  });

  it('treats * and / as §6.1 boundaries for pax and duration', () => {
    expect(decode('MECP/1/S01 *3pax*').extracted.count).toBe(3);
    const slash = decode('MECP/2/C01 R03 3pax/45min');
    expect(slash.extracted.count).toBe(3);
    expect(slash.extracted.duration).toBe(45);
    expect(slash.extracted.durationToken).toBe('45min');
  });
});
