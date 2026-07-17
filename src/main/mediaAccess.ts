/** Shared OS media-permission helpers for camera and microphone. */

export type MediaAccessType = 'camera' | 'microphone';

/** Fixed OS privacy deep links — never open user-controlled URLs. */
export const MEDIA_PRIVACY_SETTINGS_URL = {
  camera: {
    darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
    win32: 'ms-settings:privacy-webcam',
  },
  microphone: {
    darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
    win32: 'ms-settings:privacy-microphone',
  },
} as const;

export function isAllowedMediaPrivacySettingsUrl(mediaType: MediaAccessType, url: string): boolean {
  const urls = MEDIA_PRIVACY_SETTINGS_URL[mediaType];
  return url === urls.darwin || url === urls.win32;
}

export interface MediaAccessResult {
  granted: boolean;
  status: string;
}

export interface MediaAccessDeps {
  platform: NodeJS.Platform;
  getMediaAccessStatus: (mediaType: MediaAccessType) => string;
  askForMediaAccess: (mediaType: MediaAccessType) => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
}

/**
 * Ensure OS-level media access before renderer getUserMedia.
 * Branches only at the OS API boundary; Chromium session `media` is granted separately.
 */
export async function ensureMediaAccess(
  mediaType: MediaAccessType,
  deps: MediaAccessDeps,
): Promise<MediaAccessResult> {
  const { platform } = deps;
  const logTag = mediaType === 'camera' ? '[cameraAccess]' : '[microphoneAccess]';
  const privacyUrls = MEDIA_PRIVACY_SETTINGS_URL[mediaType];

  if (platform === 'linux') {
    return { granted: true, status: 'granted' };
  }

  if (platform === 'darwin') {
    let status = deps.getMediaAccessStatus(mediaType);
    if (status === 'granted') {
      return { granted: true, status };
    }
    const asked = await deps.askForMediaAccess(mediaType);
    if (asked) {
      return { granted: true, status: 'granted' };
    }
    status = deps.getMediaAccessStatus(mediaType);
    if (status === 'granted') {
      return { granted: true, status };
    }
    try {
      await deps.openExternal(privacyUrls.darwin);
    } catch (e) {
      console.warn(
        `${logTag} Failed to open macOS ${mediaType} privacy settings:`,
        e instanceof Error ? e.message : String(e),
      );
    }
    return { granted: false, status: status || 'denied' };
  }

  if (platform === 'win32') {
    const status = deps.getMediaAccessStatus(mediaType);
    if (status === 'denied') {
      try {
        await deps.openExternal(privacyUrls.win32);
      } catch (e) {
        console.warn(
          `${logTag} Failed to open Windows ${mediaType} privacy settings:`,
          e instanceof Error ? e.message : String(e),
        );
      }
      return { granted: false, status };
    }
    return { granted: true, status: status || 'granted' };
  }

  return { granted: true, status: 'granted' };
}
