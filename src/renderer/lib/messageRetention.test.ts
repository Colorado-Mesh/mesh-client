import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MESSAGE_RETENTION,
  fetchMessageRetention,
  MESSAGE_RETENTION_DEFAULT_COUNT,
  MESSAGE_RETENTION_KEYS,
  MESSAGE_RETENTION_MAX_COUNT,
  MESSAGE_RETENTION_MIN_COUNT,
  parseMessageRetention,
} from './messageRetention';

describe('parseMessageRetention', () => {
  it('returns defaults for null/empty input', () => {
    expect(parseMessageRetention(null)).toEqual(DEFAULT_MESSAGE_RETENTION);
    expect(parseMessageRetention(undefined)).toEqual(DEFAULT_MESSAGE_RETENTION);
    expect(parseMessageRetention({})).toEqual(DEFAULT_MESSAGE_RETENTION);
  });

  it("treats '1' as enabled and '0' as disabled, defaulting on garbage", () => {
    const r = parseMessageRetention({
      [MESSAGE_RETENTION_KEYS.meshtasticEnabled]: '0',
      [MESSAGE_RETENTION_KEYS.meshcoreEnabled]: '1',
    });
    expect(r.meshtasticEnabled).toBe(false);
    expect(r.meshcoreEnabled).toBe(true);

    const garbage = parseMessageRetention({
      [MESSAGE_RETENTION_KEYS.meshtasticEnabled]: 'true', // not '1' or '0' → fallback
    });
    expect(garbage.meshtasticEnabled).toBe(DEFAULT_MESSAGE_RETENTION.meshtasticEnabled);
  });

  it('clamps stored counts to [MIN, MAX]', () => {
    const tooLow = parseMessageRetention({
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '5',
    });
    expect(tooLow.meshtasticCount).toBe(MESSAGE_RETENTION_MIN_COUNT);

    const tooHigh = parseMessageRetention({
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '999999999',
    });
    expect(tooHigh.meshtasticCount).toBe(MESSAGE_RETENTION_MAX_COUNT);

    const valid = parseMessageRetention({
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '4000',
    });
    expect(valid.meshtasticCount).toBe(MESSAGE_RETENTION_DEFAULT_COUNT);
  });

  it('falls back to default count when value is non-numeric', () => {
    const r = parseMessageRetention({
      [MESSAGE_RETENTION_KEYS.meshcoreCount]: 'NaN-ish',
    });
    expect(r.meshcoreCount).toBe(MESSAGE_RETENTION_DEFAULT_COUNT);
  });
});

describe('fetchMessageRetention', () => {
  beforeEach(() => {
    // Silence the warn we emit on IPC failure — exercised in one test below.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed values from the IPC bridge', async () => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockResolvedValueOnce({
      [MESSAGE_RETENTION_KEYS.meshtasticEnabled]: '0',
      [MESSAGE_RETENTION_KEYS.meshtasticCount]: '4000',
      [MESSAGE_RETENTION_KEYS.meshcoreEnabled]: '1',
      [MESSAGE_RETENTION_KEYS.meshcoreCount]: '7500',
    });
    const r = await fetchMessageRetention();
    expect(r).toEqual({
      meshtasticEnabled: false,
      meshtasticCount: 4000,
      meshcoreEnabled: true,
      meshcoreCount: 7500,
    });
  });

  it('falls back to defaults when the IPC bridge throws', async () => {
    vi.mocked(window.electronAPI.appSettings.getAll).mockRejectedValueOnce(new Error('no IPC'));
    const r = await fetchMessageRetention();
    expect(r).toEqual(DEFAULT_MESSAGE_RETENTION);
    expect(console.warn).toHaveBeenCalled();
  });
});
