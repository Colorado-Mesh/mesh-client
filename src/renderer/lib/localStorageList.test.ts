import { describe, expect, it } from 'vitest';

import { loadCanonicalStringList, readRawStringList, writeStringList } from './localStorageList';

describe('readRawStringList', () => {
  it('returns [] for missing key', () => {
    expect(readRawStringList('mesh-client:nonexistent')).toEqual([]);
  });

  it('parses a valid JSON string list', () => {
    localStorage.setItem('mesh-client:list', JSON.stringify(['a', 'b', 'c']));
    expect(readRawStringList('mesh-client:list')).toEqual(['a', 'b', 'c']);
  });

  it('returns [] for invalid JSON', () => {
    localStorage.setItem('mesh-client:list', 'not json');
    expect(readRawStringList('mesh-client:list')).toEqual([]);
  });

  it('returns [] for non-array JSON', () => {
    localStorage.setItem('mesh-client:list', JSON.stringify({ a: 1 }));
    expect(readRawStringList('mesh-client:list')).toEqual([]);
  });

  it('filters out non-string entries', () => {
    localStorage.setItem('mesh-client:list', JSON.stringify(['a', 1, null, 'b']));
    expect(readRawStringList('mesh-client:list')).toEqual(['a', 'b']);
  });
});

describe('writeStringList', () => {
  it('writes a JSON string list', () => {
    writeStringList('mesh-client:list', ['a', 'b']);
    expect(readRawStringList('mesh-client:list')).toEqual(['a', 'b']);
  });

  it('handles empty list', () => {
    writeStringList('mesh-client:list', []);
    expect(readRawStringList('mesh-client:list')).toEqual([]);
  });
});

describe('loadCanonicalStringList', () => {
  it('returns the canonicalized list', () => {
    localStorage.setItem('mesh-client:list', JSON.stringify(['b', 'a', 'c']));
    const result = loadCanonicalStringList('mesh-client:list', (items) => [...items].sort());
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('rewrites storage when on-disk form drifts', () => {
    localStorage.setItem('mesh-client:list', JSON.stringify(['b', 'a']));
    loadCanonicalStringList('mesh-client:list', (items) => [...items].sort());
    expect(readRawStringList('mesh-client:list')).toEqual(['a', 'b']);
  });

  it('handles missing key', () => {
    const result = loadCanonicalStringList('mesh-client:missing', (items) => items);
    expect(result).toEqual([]);
  });
});
