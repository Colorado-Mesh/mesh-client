import { describe, expect, it } from 'vitest';

import {
  sanitizeReticulumDisplayName,
  sanitizeReticulumDisplayNameForDb,
} from './reticulumDisplayName';

describe('sanitizeReticulumDisplayName', () => {
  it('passes through plain UTF-8 names', () => {
    expect(sanitizeReticulumDisplayName('Alice Node')).toBe('Alice Node');
  });

  it('extracts server_name from JSON announces', () => {
    expect(sanitizeReticulumDisplayName('{"server_name": "Aurora Mesh \\u2014 Cosmos BBS"}')).toBe(
      'Aurora Mesh — Cosmos BBS',
    );
  });

  it('rejects RMAP geo JSON blobs', () => {
    expect(
      sanitizeReticulumDisplayName(
        '{"h":"5440f5d4485a00fb8441ad94fbdee46e","ha":"0","c":"1","c_n":"County/Region/City","r":"1","r_n":"Country,Country/Region"}',
      ),
    ).toBeUndefined();
  });

  it('rejects unknown JSON objects', () => {
    expect(sanitizeReticulumDisplayName('{"foo":"bar"}')).toBeUndefined();
  });

  it('returns undefined for empty input', () => {
    expect(sanitizeReticulumDisplayName('')).toBeUndefined();
    expect(sanitizeReticulumDisplayName(null)).toBeUndefined();
  });
});

describe('sanitizeReticulumDisplayNameForDb', () => {
  it('maps missing or invalid names to null', () => {
    expect(sanitizeReticulumDisplayNameForDb(null)).toBeNull();
    expect(sanitizeReticulumDisplayNameForDb(undefined)).toBeNull();
    expect(sanitizeReticulumDisplayNameForDb('')).toBeNull();
    expect(sanitizeReticulumDisplayNameForDb('{"h":"abc"}')).toBeNull();
  });

  it('returns sanitized plain names for SQLite upsert', () => {
    expect(sanitizeReticulumDisplayNameForDb('Runr02')).toBe('Runr02');
  });
});
