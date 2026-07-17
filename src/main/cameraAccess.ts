import {
  ensureMediaAccess,
  isAllowedMediaPrivacySettingsUrl,
  MEDIA_PRIVACY_SETTINGS_URL,
  type MediaAccessDeps,
  type MediaAccessResult,
} from './mediaAccess';

/** Fixed OS privacy deep links — never open user-controlled URLs. */
export const CAMERA_PRIVACY_SETTINGS_URL = MEDIA_PRIVACY_SETTINGS_URL.camera;

/** Allowlist check for shell.openExternal deep links (OS schemes, not http/https). */
export function isAllowedCameraPrivacySettingsUrl(url: string): boolean {
  return isAllowedMediaPrivacySettingsUrl('camera', url);
}

export type CameraAccessResult = MediaAccessResult;

export type CameraAccessDeps = Omit<
  MediaAccessDeps,
  'getMediaAccessStatus' | 'askForMediaAccess'
> & {
  getMediaAccessStatus: (mediaType: 'camera') => string;
  askForMediaAccess: (mediaType: 'camera') => Promise<boolean>;
};

/**
 * Ensure OS-level camera access before renderer getUserMedia({ video }).
 * Branches only at the OS API boundary; Chromium session `media` is granted separately.
 */
export async function ensureCameraAccess(deps: CameraAccessDeps): Promise<CameraAccessResult> {
  return ensureMediaAccess('camera', deps as MediaAccessDeps);
}
