import { Mic, MicOff, PhoneOff } from 'lucide-react-motion';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  reticulumVoiceAnswer,
  reticulumVoiceHangup,
  reticulumVoiceReject,
  reticulumVoiceSetMuted,
  startReticulumVoiceMediaForActiveCall,
  stopReticulumVoiceMedia,
} from '@/renderer/lib/reticulumVoiceSession';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';

/**
 * Incoming-call modal + compact in-call bar. Mount once from App when hasLxstVoice.
 */
export function ReticulumVoiceOverlay() {
  const { t } = useTranslation();
  const incoming = useReticulumVoiceStore((s) => s.incomingCall);
  const active = useReticulumVoiceStore((s) => s.activeCall);
  const muted = useReticulumVoiceStore((s) => s.microphoneMuted);

  useEffect(() => {
    const status = active?.status;
    if (status === 'established' || status === 'connecting') {
      void startReticulumVoiceMediaForActiveCall();
    }
    if (active == null) {
      stopReticulumVoiceMedia();
    }
  }, [active]);

  const showIncoming =
    incoming?.role === 'incoming' &&
    (incoming.status === 'ringing' || incoming.status === 'available');

  const showInCall =
    active != null &&
    !showIncoming &&
    (active.status === 'calling' ||
      active.status === 'connecting' ||
      active.status === 'established' ||
      active.status === 'ringing');

  if (!showIncoming && !showInCall) return null;

  if (showIncoming && incoming) {
    return (
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 sm:items-center"
        role="dialog"
        aria-modal="true"
        aria-label={t('reticulumVoice.incomingTitle')}
      >
        <div className="bg-deep-black w-full max-w-md rounded-lg border border-gray-600 p-4 shadow-lg">
          <h2 className="text-bright-green mb-2 text-lg font-semibold">
            {t('reticulumVoice.incomingTitle')}
          </h2>
          <p className="mb-4 font-mono text-sm text-gray-300">{incoming.remote_identity}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="bg-readable-green rounded px-3 py-2 text-sm font-medium text-white"
              aria-label={t('reticulumVoice.answerAria')}
              onClick={() => void reticulumVoiceAnswer()}
            >
              {t('reticulumVoice.answer')}
            </button>
            <button
              type="button"
              className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white"
              aria-label={t('reticulumVoice.rejectAria')}
              onClick={() => void reticulumVoiceReject()}
            >
              {t('reticulumVoice.reject')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!active) return null;

  return (
    <div
      className="fixed right-3 bottom-3 z-[70] flex items-center gap-2 rounded-lg border border-gray-600 bg-slate-900/95 px-3 py-2 shadow-lg"
      role="status"
      aria-label={t('reticulumVoice.inCall')}
    >
      <span className="text-xs text-gray-200">
        {active.status === 'calling' || active.status === 'connecting'
          ? t('reticulumVoice.calling')
          : t('reticulumVoice.inCall')}
      </span>
      <span className="max-w-[8rem] truncate font-mono text-[10px] text-gray-400">
        {active.remote_identity}
      </span>
      <button
        type="button"
        className="rounded p-1.5 text-gray-100 hover:bg-slate-700"
        aria-label={muted ? t('reticulumVoice.unmuteAria') : t('reticulumVoice.muteAria')}
        onClick={() => void reticulumVoiceSetMuted(!muted)}
      >
        {muted ? (
          <MicOff className="h-4 w-4" aria-hidden />
        ) : (
          <Mic className="h-4 w-4" aria-hidden />
        )}
      </button>
      <button
        type="button"
        className="rounded bg-red-600 p-1.5 text-white hover:bg-red-500"
        aria-label={t('reticulumVoice.hangupAria')}
        onClick={() => void reticulumVoiceHangup()}
      >
        <PhoneOff className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
