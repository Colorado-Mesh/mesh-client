import {
  ensureMediaAccess,
  isAllowedMediaPrivacySettingsUrl,
  MEDIA_PRIVACY_SETTINGS_URL,
  type MediaAccessDeps,
  type MediaAccessResult,
} from './mediaAccess';

/** Fixed OS privacy deep links — never open user-controlled URLs. */
export const MIC_PRIVACY_SETTINGS_URL = MEDIA_PRIVACY_SETTINGS_URL.microphone;

/** Allowlist check for shell.openExternal deep links (OS schemes, not http/https). */
export function isAllowedMicrophonePrivacySettingsUrl(url: string): boolean {
  return isAllowedMediaPrivacySettingsUrl('microphone', url);
}

export type MicrophoneAccessResult = MediaAccessResult;

export type MicrophoneAccessDeps = Omit<
  MediaAccessDeps,
  'getMediaAccessStatus' | 'askForMediaAccess'
> & {
  getMediaAccessStatus: (mediaType: 'microphone') => string;
  askForMediaAccess: (mediaType: 'microphone') => Promise<boolean>;
};

/**
 * Ensure OS-level microphone access before renderer getUserMedia.
 * Branches only at the OS API boundary; Chromium session `media` is granted separately.
 */
export async function ensureMicrophoneAccess(
  deps: MicrophoneAccessDeps,
): Promise<MicrophoneAccessResult> {
  return ensureMediaAccess('microphone', deps as MediaAccessDeps);
}
