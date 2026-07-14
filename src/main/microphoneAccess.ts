/** Fixed OS privacy deep links — never open user-controlled URLs. */
export const MIC_PRIVACY_SETTINGS_URL = {
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  win32: 'ms-settings:privacy-microphone',
} as const;

/** Allowlist check for shell.openExternal deep links (OS schemes, not http/https). */
export function isAllowedMicrophonePrivacySettingsUrl(url: string): boolean {
  return url === MIC_PRIVACY_SETTINGS_URL.darwin || url === MIC_PRIVACY_SETTINGS_URL.win32;
}

export interface MicrophoneAccessResult {
  granted: boolean;
  status: string;
}

export interface MicrophoneAccessDeps {
  platform: NodeJS.Platform;
  getMediaAccessStatus: (mediaType: 'microphone') => string;
  askForMediaAccess: (mediaType: 'microphone') => Promise<boolean>;
  openExternal: (url: string) => Promise<void>;
}

/**
 * Ensure OS-level microphone access before renderer getUserMedia.
 * Branches only at the OS API boundary; Chromium session `media` is granted separately.
 */
export async function ensureMicrophoneAccess(
  deps: MicrophoneAccessDeps,
): Promise<MicrophoneAccessResult> {
  const { platform } = deps;

  if (platform === 'linux') {
    return { granted: true, status: 'granted' };
  }

  if (platform === 'darwin') {
    let status = deps.getMediaAccessStatus('microphone');
    if (status === 'granted') {
      return { granted: true, status };
    }
    const asked = await deps.askForMediaAccess('microphone');
    if (asked) {
      return { granted: true, status: 'granted' };
    }
    status = deps.getMediaAccessStatus('microphone');
    if (status === 'granted') {
      return { granted: true, status };
    }
    try {
      await deps.openExternal(MIC_PRIVACY_SETTINGS_URL.darwin);
    } catch (e) {
      console.warn(
        '[microphoneAccess] Failed to open macOS microphone privacy settings:',
        e instanceof Error ? e.message : String(e),
      );
    }
    return { granted: false, status: status || 'denied' };
  }

  if (platform === 'win32') {
    const status = deps.getMediaAccessStatus('microphone');
    if (status === 'denied') {
      try {
        await deps.openExternal(MIC_PRIVACY_SETTINGS_URL.win32);
      } catch (e) {
        console.warn(
          '[microphoneAccess] Failed to open Windows microphone privacy settings:',
          e instanceof Error ? e.message : String(e),
        );
      }
      return { granted: false, status };
    }
    // granted / unknown / not-determined — proceed to getUserMedia
    return { granted: true, status: status || 'granted' };
  }

  return { granted: true, status: 'granted' };
}
