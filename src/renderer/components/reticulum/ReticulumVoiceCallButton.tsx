import { Phone } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { RETICULUM_DM_HEADER_ACTION_CLASS } from '@/renderer/lib/reticulumDmHeaderActions';
import { peerLxstTelephonyCapability } from '@/renderer/lib/reticulumVoiceCapability';
import { reticulumVoiceCallPeer } from '@/renderer/lib/reticulumVoiceSession';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';
import { isReticulumVoiceSessionBusy } from '@/shared/voice-types';

interface ReticulumVoiceCallButtonProps {
  lxmfPeerHash: string;
  identityHash?: string | null;
  disabled?: boolean;
  className?: string;
}

/** Compact Call control for Peers rows / Chat DM header. */
export function ReticulumVoiceCallButton({
  lxmfPeerHash,
  identityHash = null,
  disabled = false,
  className = `${RETICULUM_DM_HEADER_ACTION_CLASS} ml-2`,
}: ReticulumVoiceCallButtonProps) {
  const { t } = useTranslation();
  // Re-render when identity activity updates so capability badge can flip to heard.
  useReticulumIdentityActivityStore((s) => s.byDestination);
  const activeCall = useReticulumVoiceStore((s) => s.activeCall);
  const incomingCall = useReticulumVoiceStore((s) => s.incomingCall);
  const sessionBusy = isReticulumVoiceSessionBusy(activeCall ?? incomingCall);
  const capability = peerLxstTelephonyCapability({ lxmfPeerHash, identityHash });
  const capabilityLabel =
    capability === 'heard'
      ? t('reticulumVoice.capabilityHeard')
      : t('reticulumVoice.capabilityUnknown');
  const ariaLabel = `${t('reticulumVoice.callAria')} — ${capabilityLabel}`;
  const title = `${ariaLabel}. ${t('reticulumVoice.help.interop')}`;

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || sessionBusy}
      aria-label={ariaLabel}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        void reticulumVoiceCallPeer(lxmfPeerHash, { identityHash });
      }}
    >
      <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>{t('reticulumVoice.call')}</span>
      <span
        className={
          capability === 'heard' ? 'text-[10px] text-cyan-300' : 'text-[10px] text-gray-500'
        }
      >
        {capability === 'heard'
          ? t('reticulumVoice.capabilityHeardShort')
          : t('reticulumVoice.capabilityUnknownShort')}
      </span>
    </button>
  );
}
