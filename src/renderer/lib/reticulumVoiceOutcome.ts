/**
 * Map LXST / sidecar voice failure reasons to toast keys + progress tones.
 */

export type VoiceTerminalKind =
  'busy' | 'connectFailed' | 'rejected' | 'noAnswer' | 'failed' | 'completed';

export function classifyVoiceTerminalReason(reason: string | null | undefined): VoiceTerminalKind {
  const r = (reason ?? '').trim().toLowerCase();
  // Empty / normal end: clean hangup, sidecar Established→terminate, or generic terminated.
  if (
    !r ||
    r === 'completed' ||
    r === 'hangup' ||
    r === 'cancelled' ||
    r === 'canceled' ||
    r === 'established' ||
    r === 'terminated'
  ) {
    return 'completed';
  }
  if (
    r === 'busy' ||
    r.includes('linebusy') ||
    r.includes('line_busy') ||
    r.includes('line busy')
  ) {
    return 'busy';
  }
  if (r === 'rejected' || r.includes('reject')) return 'rejected';
  // Connect-phase failures (before / without answered media) → busy tone + connect toast.
  if (
    r.includes('discovery') ||
    r.includes('unreachable') ||
    r.includes('safety') ||
    r.includes('not established') ||
    r.includes('connect_failed') ||
    r.includes('could not connect') ||
    r.includes('no path') ||
    r.includes('outgoing_failed') ||
    r.includes('outgoing call failed')
  ) {
    return 'connectFailed';
  }
  if (
    r.includes('timeout') ||
    r.includes('timed out') ||
    r.includes('no answer') ||
    r.includes('ring_timeout') ||
    r.includes('outgoing_timeout')
  ) {
    return 'noAnswer';
  }
  return 'failed';
}

/** Toast keys for kinds that surface a toast; null = tone-only / silent. */
export function voiceToastKeyForTerminal(kind: VoiceTerminalKind): string | null {
  switch (kind) {
    case 'busy':
      return 'reticulumVoice.toast.busy';
    case 'connectFailed':
      return 'reticulumVoice.toast.connectFailed';
    case 'rejected':
      // Kept for i18n literal registration; toast gated off in applyVoiceTerminalFeedback.
      return 'reticulumVoice.toast.rejected';
    case 'noAnswer':
      return 'reticulumVoice.toast.noAnswer';
    case 'failed':
      return 'reticulumVoice.toast.failed';
    case 'completed':
      return null;
  }
}

/** Only connect-failure and line-busy toast by default. */
export function shouldToastVoiceTerminal(kind: VoiceTerminalKind): boolean {
  return kind === 'busy' || kind === 'connectFailed';
}
