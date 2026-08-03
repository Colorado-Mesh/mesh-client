import { Phone } from 'lucide-react-motion';
import { useTranslation } from 'react-i18next';

import { reticulumVoiceCallPeer } from '@/renderer/lib/reticulumVoiceSession';

interface ReticulumVoiceCallButtonProps {
  lxmfPeerHash: string;
  disabled?: boolean;
  className?: string;
}

/** Compact Call control for Peers rows / Chat DM header. */
export function ReticulumVoiceCallButton({
  lxmfPeerHash,
  disabled = false,
  className = 'ml-2 text-cyan-400 hover:underline disabled:opacity-40',
}: ReticulumVoiceCallButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      aria-label={t('reticulumVoice.callAria')}
      onClick={(e) => {
        e.stopPropagation();
        void reticulumVoiceCallPeer(lxmfPeerHash);
      }}
    >
      <Phone className="inline h-3.5 w-3.5" aria-hidden />
      <span className="ml-1">{t('reticulumVoice.call')}</span>
    </button>
  );
}
