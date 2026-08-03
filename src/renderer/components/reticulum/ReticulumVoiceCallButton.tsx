import { Phone } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { peerLxstTelephonyCapability } from '@/renderer/lib/reticulumVoiceCapability';
import { reticulumVoiceCallPeer } from '@/renderer/lib/reticulumVoiceSession';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';

interface ReticulumVoiceCallButtonProps {
  lxmfPeerHash: string;
  identityHash?: string | null;
  disabled?: boolean;
  className?: string;
  /** Show short interop hint under the button (Chat DM). */
  showHelp?: boolean;
}

/** Compact Call control for Peers rows / Chat DM header. */
export function ReticulumVoiceCallButton({
  lxmfPeerHash,
  identityHash = null,
  disabled = false,
  className = 'ml-2 text-cyan-400 hover:underline disabled:opacity-40',
  showHelp = false,
}: ReticulumVoiceCallButtonProps) {
  const { t } = useTranslation();
  // Re-render when identity activity updates so capability badge can flip to heard.
  useReticulumIdentityActivityStore((s) => s.byDestination);
  const capability = peerLxstTelephonyCapability({ lxmfPeerHash, identityHash });
  const capabilityLabel =
    capability === 'heard'
      ? t('reticulumVoice.capabilityHeard')
      : t('reticulumVoice.capabilityUnknown');
  const title = `${t('reticulumVoice.callAria')} — ${capabilityLabel}. ${t('reticulumVoice.help.interop')}`;

  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        className={className}
        disabled={disabled}
        aria-label={title}
        title={title}
        onClick={(e) => {
          e.stopPropagation();
          void reticulumVoiceCallPeer(lxmfPeerHash, { identityHash });
        }}
      >
        <Phone className="inline h-3.5 w-3.5" aria-hidden />
        <span className="ml-1">{t('reticulumVoice.call')}</span>
        <span
          className={
            capability === 'heard'
              ? 'ml-1 text-[10px] text-cyan-300'
              : 'ml-1 text-[10px] text-gray-500'
          }
        >
          {capability === 'heard'
            ? t('reticulumVoice.capabilityHeardShort')
            : t('reticulumVoice.capabilityUnknownShort')}
        </span>
      </button>
      {showHelp ? (
        <span className="mt-0.5 max-w-[14rem] text-[10px] leading-tight text-gray-500">
          {t('reticulumVoice.help.interop')}
        </span>
      ) : null}
    </span>
  );
}
