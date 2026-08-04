/**
 * Shared LXST voice terminal feedback (tones + toasts) and IPC error humanization.
 */

import { pushAppToast } from '@/renderer/components/Toast';
import i18n from '@/renderer/lib/i18n';
import {
  playVoiceBusyTone,
  playVoiceFailTone,
  stopVoiceCallTones,
} from '@/renderer/lib/reticulumVoiceCallTones';
import {
  classifyVoiceTerminalReason,
  type VoiceTerminalKind,
  voiceToastKeyForTerminal,
} from '@/renderer/lib/reticulumVoiceOutcome';

/** Map sidecar/IPC English fragments to i18n keys; never toast raw sidecar English. */
export function humanizeVoiceIpcError(raw: string | null | undefined): string {
  const msg = (raw ?? '').trim();
  if (!msg) return i18n.t('reticulumVoice.errors.callFailed');
  const lower = msg.toLowerCase();
  if (lower.includes('voice not available') || lower.includes('not available')) {
    return i18n.t('reticulumVoice.errors.notRunning');
  }
  return i18n.t('reticulumVoice.errors.callFailed');
}

/** Shared busy/fail tones + toast for terminal outcomes (hangup + WS terminate). */
export function applyVoiceTerminalFeedback(
  reason: string | null | undefined,
  opts?: { showToast?: boolean },
): VoiceTerminalKind {
  const kind = classifyVoiceTerminalReason(reason);
  stopVoiceCallTones();
  if (kind === 'busy') playVoiceBusyTone();
  else if (kind === 'noAnswer' || kind === 'failed' || kind === 'rejected') playVoiceFailTone();

  const showToast = opts?.showToast !== false;
  const toastKey = voiceToastKeyForTerminal(kind);
  if (showToast && toastKey) {
    pushAppToast(i18n.t(toastKey), 'error');
  }
  return kind;
}
