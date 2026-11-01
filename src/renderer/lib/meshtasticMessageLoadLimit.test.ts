import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./appSettingsStorage', () => ({
  getAppSettingsRaw: vi.fn(() => null),
}));

import { getAppSettingsRaw } from './appSettingsStorage';
import { getMeshtasticMessageLoadLimit } from './meshtasticMessageLoadLimit';

describe('getMeshtasticMessageLoadLimit', () => {
  beforeEach(() => {
    vi.mocked(getAppSettingsRaw).mockReturnValue(null);
  });

  it('defaults to 1000 when settings are missing', () => {
    expect(getMeshtasticMessageLoadLimit()).toBe(1000);
  });

  it('returns 10000 when the load limit is disabled', () => {
    vi.mocked(getAppSettingsRaw).mockReturnValue(
      JSON.stringify({ messageLimitEnabled: false, messageLimitCount: 50 }),
    );
    expect(getMeshtasticMessageLoadLimit()).toBe(10000);
  });

  it('clamps valid integers to at least 1', () => {
    vi.mocked(getAppSettingsRaw).mockReturnValue(
      JSON.stringify({ messageLimitEnabled: true, messageLimitCount: 0 }),
    );
    expect(getMeshtasticMessageLoadLimit()).toBe(1);
    vi.mocked(getAppSettingsRaw).mockReturnValue(
      JSON.stringify({ messageLimitEnabled: true, messageLimitCount: -5 }),
    );
    expect(getMeshtasticMessageLoadLimit()).toBe(1);
    vi.mocked(getAppSettingsRaw).mockReturnValue(
      JSON.stringify({ messageLimitEnabled: true, messageLimitCount: 42 }),
    );
    expect(getMeshtasticMessageLoadLimit()).toBe(42);
  });

  it('falls back to 1000 for non-finite or non-integer counts', () => {
    for (const messageLimitCount of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, '1000']) {
      vi.mocked(getAppSettingsRaw).mockReturnValue(
        JSON.stringify({ messageLimitEnabled: true, messageLimitCount }),
      );
      expect(getMeshtasticMessageLoadLimit()).toBe(1000);
    }
  });
});
