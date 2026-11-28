/**
 * MECP 1.4.1 freetext conformance — mirrors mecp-org/MECP scripts/check-freetext.mjs
 * against vendored freetext/tests.json and patterns.json.
 *
 * Upstream cases use `{ title, input, expect }` (manifest schemaVersion 2):
 * `expect` is the full decoded convention map (null values = not decoded), or
 * `null` when the message is invalid.
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
  title: string;
  input: string;
  expect: Record<string, unknown> | null;
}

const CASES = tests as FreetextTestCase[];

/** Match upstream check-freetext.mjs: omit null expect entries (same as absent). */
function stripNullExpect(expectMap: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(expectMap).filter(([, v]) => v !== null));
}

/** Full convention map from one message, or null when the envelope does not match. */
function decodeMessageConventions(input: string): Record<string, unknown> | null {
  const env = matchMessageEnvelope(input);
  if (!env) return null;
  const extracted = extractFreetextConventions(env.freetext, env.codes);
  const got: Record<string, unknown> = {};
  if (extracted.appDesignator != null) got.appDesignator = extracted.appDesignator;
  if (extracted.count != null) got.pax = extracted.count;
  if (extracted.gps != null) got.gps = extracted.gps;
  if (extracted.duration != null) got.duration = extracted.duration;
  if (extracted.reference != null) got.reference = extracted.reference;
  if (extracted.language != null) got.language = extracted.language;
  if (extracted.timestamp != null) got.timestamp = extracted.timestamp;
  if (extracted.callsign != null) got.callsign = extracted.callsign;
  return got;
}

describe('MECP 1.4.1 freetext patterns fixture', () => {
  it('keeps every pattern string loadable from patterns.json', () => {
    expect(typeof patterns.message.decode).toBe('string');
    expect(MESSAGE_ENVELOPE_RE.test('MECP/1/T05')).toBe(true);
    expect(MESSAGE_ENVELOPE_RE.test('MECP/1/T05 ')).toBe(false);
    expect(patterns.duration.scope).toBe('R03');
    expect(Array.isArray(patterns.duration.decode)).toBe(true);
  });

  it('vendors tests.json and manifest.json beside patterns.json', () => {
    const raw = readFileSync(join(ROOT, 'freetext/tests.json'), 'utf8');
    expect(JSON.parse(raw)).toEqual(tests);
    const manifest = JSON.parse(readFileSync(join(ROOT, 'freetext/manifest.json'), 'utf8')) as {
      protocolVersion: string;
      schemaVersion: number;
      tests: string;
      patterns: string;
    };
    expect(manifest.protocolVersion).toBe('1.4.1');
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.tests).toBe('tests.json');
    expect(manifest.patterns).toBe('patterns.json');
  });

  it('drops seconds from duration encode patterns (1.4.0+)', () => {
    for (const pat of patterns.duration.encode) {
      expect(pat).not.toMatch(/\[Ss\]/);
      expect(pat).not.toMatch(/\)s$/);
    }
    expect(patterns.duration.encode).toHaveLength(3);
    expect(patterns.duration.decode).toHaveLength(5);
  });
});

describe('MECP 1.4.1 freetext conformance (upstream tests.json)', () => {
  it.each(CASES)('$title', (t) => {
    const got = decodeMessageConventions(t.input);
    if (t.expect === null) {
      expect(got).toBeNull();
      return;
    }
    expect(got).toEqual(stripNullExpect(t.expect));
  });

  it('uses strict duration encode patterns without spaces before units', () => {
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
    expect(duration.valid).toBe(true);
    expect(duration.extracted.duration).toBe(45);
    expect(duration.extracted.durationToken).toBe('45min');
    expect(decode('MECP/3/L06 45min').extracted.duration).toBeNull();

    // Any positive min/h/d total, no 1440-minute upper bound
    expect(decode('MECP/2/R03 2d').extracted.duration).toBe(2880);
    expect(decode('MECP/2/R03 48h').extracted.duration).toBe(2880);
    expect(decode('MECP/2/R03 2880min').extracted.duration).toBe(2880);

    // First by position; seconds are not a duration unit
    expect(decode('MECP/2/R03 2d 45min').extracted.duration).toBe(2880);
    expect(decode('MECP/2/R03 30s').extracted.duration).toBeNull();
    expect(decode('MECP/2/R03 30s 45min').extracted.duration).toBe(45);

    const cs = decode('MECP/3/L20 ~DL/OK1ABC');
    expect(cs.extracted.callsign).toBe('DL/OK1ABC');
    expect(decode('MECP/3/L20 ~W1AW-9').extracted.callsign).toBeNull();

    const ref = decode('MECP/2/C08 #base-camp,');
    expect(ref.extracted.reference).toBe('base-camp');

    const ts = decode('MECP/3/L06 @2460 @1400 @1530');
    expect(ts.extracted.timestamp).toBe('14:00');
  });

  it('decode() strips one trailing CR/LF and rejects interior breaks', () => {
    expect(decode('MECP/1/T05 T05 damaged\n').valid).toBe(true);
    expect(decode('MECP/1/T05 T05 damaged\r\n').valid).toBe(true);
    expect(decode('MECP/1/T05 foo\nbar').valid).toBe(false);
    expect(decode('MECP/1/T05 ').valid).toBe(false);
  });
});
