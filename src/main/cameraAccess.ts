/** Fixed OS privacy deep links — never open user-controlled URLs. */
export const CAMERA_PRIVACY_SETTINGS_URL = {
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  win32: 'ms-settings:privacy-webcam',
} as const;

/** Allowlist check for shell.openExternal deep links (OS schemes, not http/https). */
export function isAllowedCameraPrivacySettingsUrl(url: string): boolean {
  return url === CAMERA_PRIVACY_SETTINGS_URL.darwin || url === CAMERA_PRIVACY_SETTINGS_URL.win32;
}

export interface CameraAccessResult {
  granted: boolean;
  status: string;
}

export interface CameraAccessDeps {
  platform: NodeJS.Platform;
  getMediaAccessStatus: (mediaType: 'camera') => string;
  askForMediaAccess: (mediaType: 'camera') => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
}

/**
 * Ensure OS-level camera access before renderer getUserMedia({ video }).
 * Branches only at the OS API boundary; Chromium session `media` is granted separately.
 */
export async function ensureCameraAccess(deps: CameraAccessDeps): Promise<CameraAccessResult> {
  const { platform } = deps;

  if (platform === 'linux') {
    return { granted: true, status: 'granted' };
  }

  if (platform === 'darwin') {
    let status = deps.getMediaAccessStatus('camera');
    if (status === 'granted') {
      return { granted: true, status };
    }
    const asked = await deps.askForMediaAccess('camera');
    if (asked) {
      return { granted: true, status: 'granted' };
    }
    status = deps.getMediaAccessStatus('camera');
    if (status === 'granted') {
      return { granted: true, status };
    }
    try {
      await deps.openExternal(CAMERA_PRIVACY_SETTINGS_URL.darwin);
    } catch (e) {
      console.warn(
        '[cameraAccess] Failed to open macOS camera privacy settings:',
        e instanceof Error ? e.message : String(e),
      );
    }
    return { granted: false, status: status || 'denied' };
  }

  if (platform === 'win32') {
    const status = deps.getMediaAccessStatus('camera');
    if (status === 'denied') {
      try {
        await deps.openExternal(CAMERA_PRIVACY_SETTINGS_URL.win32);
      } catch (e) {
        console.warn(
          '[cameraAccess] Failed to open Windows camera privacy settings:',
          e instanceof Error ? e.message : String(e),
        );
      }
      return { granted: false, status };
    }
    return { granted: true, status: status || 'granted' };
  }

  return { granted: true, status: 'granted' };
}
