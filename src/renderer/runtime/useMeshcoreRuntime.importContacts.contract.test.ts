// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

function sliceBetween(start: string, end: string): string {
  const from = SOURCE.indexOf(start);
  expect(from).toBeGreaterThanOrEqual(0);
  const to = SOURCE.indexOf(end, from);
  expect(to).toBeGreaterThan(from);
  return SOURCE.slice(from, to);
}

describe('useMeshcoreRuntime importContacts (contract)', () => {
  it('returns empty counts when the file picker is cancelled', () => {
    const body = sliceBetween(
      'const importContacts = useCallback(async (): Promise<{',
      'function parsePublicKey(rawKey: string): Uint8Array | null {',
    );
    expect(body).toContain('openJsonFile()');
    expect(body).toMatch(
      /if \(raw == null\) \{\s*return \{ imported: 0, skipped: 0, errors: \[\] \};/,
    );
  });

  it('accepts a root array or an object that contains an array', () => {
    const body = sliceBetween(
      'let parsed: unknown[];',
      'function parsePublicKey(rawKey: string): Uint8Array | null {',
    );
    expect(body).toContain('JSON.parse(raw)');
    expect(body).toContain('Array.isArray(val)');
    expect(body).toContain('Object.values(val as Record<string, unknown>).filter(Array.isArray)');
    expect(body).toContain('JSON contains no array of entries');
  });

  it('returns a parse error instead of throwing on invalid JSON', () => {
    const body = sliceBetween(
      'let parsed: unknown[];',
      'function parsePublicKey(rawKey: string): Uint8Array | null {',
    );
    expect(body).toContain('importContacts: parse error');
    expect(body).toMatch(
      /return \{ imported: 0, skipped: 0, errors: \[e instanceof Error \? e\.message : String\(e\)\] \};/,
    );
  });

  it('skips entries with missing names or invalid public keys', () => {
    const body = sliceBetween('for (const r of parsed) {', 'if (validEntries.length > 0) {');
    expect(body).toContain('invalid public key');
    expect(body).toContain('Skipped "${name}": invalid public key');
    expect(body).toMatch(/if \(!name \|\| !rawKey\) \{\s*skipped\+\+;/);
  });
});
