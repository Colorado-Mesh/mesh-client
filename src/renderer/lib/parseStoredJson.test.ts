import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseStoredJson } from './parseStoredJson';

describe('parseStoredJson', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null for null or empty input without warning', () => {
    expect(parseStoredJson(null, 'test')).toBeNull();
    expect(parseStoredJson('', 'test')).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('parses valid JSON', () => {
    expect(parseStoredJson('{"a":1}', 'test')).toEqual({ a: 1 });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('returns null and warns for invalid JSON strings', () => {
    expect(parseStoredJson('{not-json', 'bad json')).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[parseStoredJson] bad json failed'),
    );
    const warnMsg = String(vi.mocked(console.warn).mock.calls[0]?.[0] ?? '');
    expect(warnMsg).not.toContain('[object Object]');
  });

  it('returns null and warns for non-string raw without [object Object] phrasing', () => {
    const raw = { polluted: true } as unknown as string | null;
    expect(parseStoredJson(raw, 'non-string raw')).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      '[parseStoredJson] non-string raw failed expected string, got object',
    );
  });
});
