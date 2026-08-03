/**
 * Map LXST / sidecar voice failure reasons to toast keys + progress tones.
 */

export type VoiceTerminalKind = 'busy' | 'rejected' | 'noAnswer' | 'failed' | 'completed';

export function classifyVoiceTerminalReason(reason: string | null | undefined): VoiceTerminalKind {
  const r = (reason ?? '').trim().toLowerCase();
  // Empty reason = clean hangup / remote end without Busy|Rejected signal.
  if (!r || r === 'completed' || r === 'hangup' || r === 'cancelled' || r === 'canceled') {
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
  if (
    r.includes('timeout') ||
    r.includes('timed out') ||
    r.includes('no answer') ||
    r.includes('discovery') ||
    r.includes('ring_timeout') ||
    r.includes('outgoing_timeout') ||
    r.includes('safety')
  ) {
    return 'noAnswer';
  }
  return 'failed';
}

export function voiceToastKeyForTerminal(kind: VoiceTerminalKind): string | null {
  switch (kind) {
    case 'busy':
      return 'reticulumVoice.toast.busy';
    case 'rejected':
      return 'reticulumVoice.toast.rejected';
    case 'noAnswer':
      return 'reticulumVoice.toast.noAnswer';
    case 'failed':
      return 'reticulumVoice.toast.failed';
    case 'completed':
      return null;
  }
}
