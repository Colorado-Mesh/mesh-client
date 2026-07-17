import { describe, expect, it, vi } from 'vitest';

import {
  CAMERA_PRIVACY_SETTINGS_URL,
  type CameraAccessDeps,
  ensureCameraAccess,
  isAllowedCameraPrivacySettingsUrl,
} from './cameraAccess';

function baseDeps(overrides: Partial<CameraAccessDeps> = {}): CameraAccessDeps {
  return {
    platform: 'linux',
    getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
    askForMediaAccess: vi.fn().mockResolvedValue(true),
    openExternal: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('isAllowedCameraPrivacySettingsUrl', () => {
  it('allows only fixed OS privacy URLs', () => {
    expect(isAllowedCameraPrivacySettingsUrl(CAMERA_PRIVACY_SETTINGS_URL.darwin)).toBe(true);
    expect(isAllowedCameraPrivacySettingsUrl(CAMERA_PRIVACY_SETTINGS_URL.win32)).toBe(true);
    expect(isAllowedCameraPrivacySettingsUrl('https://evil.example')).toBe(false);
  });
});

describe('ensureCameraAccess', () => {
  it.each(['linux', 'darwin', 'win32'] as const)(
    'returns granted on %s when access is available',
    async (platform) => {
      const deps = baseDeps({
        platform,
        getMediaAccessStatus: vi.fn().mockReturnValue('granted'),
      });
      const result = await ensureCameraAccess(deps);
      expect(result.granted).toBe(true);
    },
  );

  it('asks for access on darwin when not determined', async () => {
    const askForMediaAccess = vi.fn().mockResolvedValue(true);
    const result = await ensureCameraAccess(
      baseDeps({
        platform: 'darwin',
        getMediaAccessStatus: vi.fn().mockReturnValue('not-determined'),
        askForMediaAccess,
      }),
    );
    expect(askForMediaAccess).toHaveBeenCalledWith('camera');
    expect(result).toEqual({ granted: true, status: 'granted' });
  });

  it('opens privacy settings on darwin when denied', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const result = await ensureCameraAccess(
      baseDeps({
        platform: 'darwin',
        getMediaAccessStatus: vi.fn().mockReturnValue('denied'),
        askForMediaAccess: vi.fn().mockResolvedValue(false),
        openExternal,
      }),
    );
    expect(openExternal).toHaveBeenCalledWith(CAMERA_PRIVACY_SETTINGS_URL.darwin);
    expect(result.granted).toBe(false);
  });

  it('opens privacy settings on win32 when denied', async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const result = await ensureCameraAccess(
      baseDeps({
        platform: 'win32',
        getMediaAccessStatus: vi.fn().mockReturnValue('denied'),
        openExternal,
      }),
    );
    expect(openExternal).toHaveBeenCalledWith(CAMERA_PRIVACY_SETTINGS_URL.win32);
    expect(result.granted).toBe(false);
  });
});
