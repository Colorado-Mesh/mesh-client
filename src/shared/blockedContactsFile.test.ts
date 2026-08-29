import { describe, expect, it } from 'vitest';

import { parseBlockedContactsFile, serializeBlockedContacts } from './blockedContactsFile';

const A = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
const B = 'b1b2c3d4e5f60718293a4b5c6d7e8f90';
const C = 'c1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('serializeBlockedContacts', () => {
  it('writes a versioned payload with normalized hashes', () => {
    const parsed = JSON.parse(serializeBlockedContacts([A.toUpperCase(), B])) as {
      version: number;
      protocol: string;
      exported_at: string;
      blocked: string[];
    };
    expect(parsed.version).toBe(1);
    expect(parsed.protocol).toBe('reticulum');
    expect(parsed.blocked).toEqual([A, B]);
    expect(Number.isNaN(Date.parse(parsed.exported_at))).toBe(false);
  });

  it('handles an empty list', () => {
    const parsed = JSON.parse(serializeBlockedContacts([])) as { blocked: string[] };
    expect(parsed.blocked).toEqual([]);
  });
});

describe('parseBlockedContactsFile', () => {
  it('reads a JSON array', () => {
    expect(parseBlockedContactsFile(JSON.stringify([A, B]))).toEqual({
      hashes: [A, B],
      skipped: 0,
    });
  });

  it('reads a JSON object with a blocked array', () => {
    expect(parseBlockedContactsFile(JSON.stringify({ version: 1, blocked: [A] }))).toEqual({
      hashes: [A],
      skipped: 0,
    });
  });

  it('reads newline-delimited text', () => {
    expect(parseBlockedContactsFile(`${A}\n${B}\n${C}`)).toEqual({
      hashes: [A, B, C],
      skipped: 0,
    });
  });

  it('reads comma-delimited text', () => {
    expect(parseBlockedContactsFile(`${A},${B}`)).toEqual({ hashes: [A, B], skipped: 0 });
  });

  it('tolerates CRLF line endings and blank lines', () => {
    expect(parseBlockedContactsFile(`${A}\r\n\r\n${B}\r\n`)).toEqual({
      hashes: [A, B],
      skipped: 0,
    });
  });

  it('ignores comment lines without counting them as skipped entries', () => {
    expect(parseBlockedContactsFile(`# exported blocklist\n${A}`)).toEqual({
      hashes: [A],
      skipped: 0,
    });
  });

  it('counts duplicates as skipped and keeps first-seen order', () => {
    expect(parseBlockedContactsFile(`${B}\n${A}\n${B.toUpperCase()}`)).toEqual({
      hashes: [B, A],
      skipped: 1,
    });
  });

  it('counts malformed entries as skipped while keeping valid ones', () => {
    const result = parseBlockedContactsFile(JSON.stringify([A, 'nope', '', 42, null, B]));
    expect(result).toEqual({ hashes: [A, B], skipped: 4 });
  });

  it('normalizes separated and uppercase entries', () => {
    const result = parseBlockedContactsFile(
      JSON.stringify(['A1:B2:C3:D4:E5:F6:07:18:29:3A:4B:5C:6D:7E:8F:90']),
    );
    expect(result).toEqual({ hashes: [A], skipped: 0 });
  });

  it('returns an empty result for empty input', () => {
    expect(parseBlockedContactsFile('')).toEqual({ hashes: [], skipped: 0 });
    expect(parseBlockedContactsFile('   \n  ')).toEqual({ hashes: [], skipped: 0 });
  });

  it('returns null for malformed JSON rather than throwing', () => {
    expect(parseBlockedContactsFile('{ "blocked": [')).toBeNull();
    expect(parseBlockedContactsFile('[1, 2,')).toBeNull();
  });

  it('returns null for a JSON object without a blocked array', () => {
    expect(parseBlockedContactsFile(JSON.stringify({ version: 1 }))).toBeNull();
  });

  it('round-trips serialize then parse', () => {
    const parsed = parseBlockedContactsFile(serializeBlockedContacts([A, B, C]));
    expect(parsed).toEqual({ hashes: [A, B, C], skipped: 0 });
  });
});
