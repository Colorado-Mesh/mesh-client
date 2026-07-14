import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureMicrophoneAccess,
  isAllowedMicrophonePrivacySettingsUrl,
  MIC_PRIVACY_SETTINGS_URL,
  type MicrophoneAccessDeps,
} from './microphoneAccess';

function makeDeps(overrides: Partial<MicrophoneAccessDeps> = {}): MicrophoneAccessDeps {
  return {
    platform: 'linux',
    getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
    askForMediaAccess: vi.fn().mockResolvedValue(true),
    openExternal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('isAllowedMicrophonePrivacySettingsUrl', () => {
  it('allows only the fixed darwin and win32 deep links', () => {
    expect(isAllowedMicrophonePrivacySettingsUrl(MIC_PRIVACY_SETTINGS_URL.darwin)).toBe(true);
    expect(isAllowedMicrophonePrivacySettingsUrl(MIC_PRIVACY_SETTINGS_URL.win32)).toBe(true);
    expect(isAllowedMicrophonePrivacySettingsUrl('https://example.com')).toBe(false);
    expect(isAllowedMicrophonePrivacySettingsUrl('ms-settings:privacy-webcam')).toBe(false);
  });
});

describe('ensureMicrophoneAccess', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(['linux', 'darwin', 'win32'] as const)(
    'returns a result object on %s',
    async (platform) => {
      const deps = makeDeps({
        platform,
        getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
      });
      const result = await ensureMicrophoneAccess(deps);
      expect(result).toEqual({ granted: true, status: 'granted' });
    },
  );

  it('linux always grants without consulting OS media APIs', async () => {
    const getMediaAccessStatus = vi.fn();
    const askForMediaAccess = vi.fn();
    const openExternal = vi.fn();
    const result = await ensureMicrophoneAccess(
      makeDeps({
        platform: 'linux',
        getMediaAccessStatus,
        askForMediaAccess,
        openExternal,
      }),
    );
    expect(result).toEqual({ granted: true, status: 'granted' });
    expect(getMediaAccessStatus).not.toHaveBeenCalled();
    expect(askForMediaAccess).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('darwin returns granted when already allowed', async () => {
    const askForMediaAccess = vi.fn();
    const openExternal = vi.fn();
    const result = await ensureMicrophoneAccess(
      makeDeps({
        platform: 'darwin',
        getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
        askForMediaAccess,
        openExternal,
      }),
    );
    expect(result).toEqual({ granted: true, status: 'granted' });
    expect(askForMediaAccess).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('darwin asks for access when not yet granted', async () => {
    const askForMediaAccess = vi.fn().mockResolvedValue(true);
    const result = await ensureMicrophoneAccess(
      makeDeps({
        platform: 'darwin',
        getMediaAccessStatus: vi.fn().mockReturnValue('not-determined'),
        askForMediaAccess,
      }),
    );
    expect(askForMediaAccess).toHaveBeenCalledWith('microphone');
    expect(result).toEqual({ granted: true, status: 'granted' });
  });

  it('darwin opens privacy settings when ask is denied', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const result = await ensureMicrophoneAccess(
      makeDeps({
        platform: 'darwin',
        getMediaAccessStatus: vi.fn().mockReturnValue('denied'),
        askForMediaAccess: vi.fn().mockResolvedValue(false),
        openExternal,
      }),
    );
    expect(openExternal).toHaveBeenCalledWith(MIC_PRIVACY_SETTINGS_URL.darwin);
    expect(result).toEqual({ granted: false, status: 'denied' });
  });

  it('win32 proceeds when status is not denied', async () => {
    const openExternal = vi.fn();
    for (const status of ['granted', 'unknown', 'not-determined'] as const) {
      const result = await ensureMicrophoneAccess(
        makeDeps({
          platform: 'win32',
          getMediaAccessStatus: vi.fn().mockReturnValue(status),
          openExternal,
        }),
      );
      expect(result).toEqual({ granted: true, status });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('win32 opens privacy settings when denied', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const result = await ensureMicrophoneAccess(
      makeDeps({
        platform: 'win32',
        getMediaAccessStatus: vi.fn().mockReturnValue('denied'),
        openExternal,
      }),
    );
    expect(openExternal).toHaveBeenCalledWith(MIC_PRIVACY_SETTINGS_URL.win32);
    expect(result).toEqual({ granted: false, status: 'denied' });
  });
});
