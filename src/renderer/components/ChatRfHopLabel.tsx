import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { useReduceMotion } from '@/renderer/lib/icons/iconMotionContext';
import {
  isMeshcoreHopCorrected,
  meshcoreChatHopUiKey,
  subscribeMeshcoreHopCorrected,
} from '@/renderer/lib/meshcoreLateRfHopEnrichment';

export interface ChatRfHopLabelProps {
  rxHops: number;
  msg: {
    storeId?: string;
    id?: number;
    sender_id: number;
    timestamp: number;
    channel: number;
  };
}

/** Class/title for the hop pill when a late RF correction mark is active. */
export function chatRfHopLabelPresentation(
  corrected: boolean,
  reduceMotion: boolean,
): { className: string; refined: boolean } {
  // gray-400 (#9ca3af) on chat slate-800 (#1e293b) keeps 4.5:1+ for text-[10px].
  if (!corrected) {
    return {
      className: 'text-[10px] text-gray-400 transition-colors duration-500',
      refined: false,
    };
  }
  if (reduceMotion) {
    return {
      className: 'text-[10px] text-gray-400 transition-colors duration-500',
      refined: true,
    };
  }
  return {
    className: 'text-[10px] text-amber-400/80 transition-colors duration-500',
    refined: true,
  };
}

/** Incoming RF hop count; briefly accents when late event 136 corrected a stored value. */
export function ChatRfHopLabel({ rxHops, msg }: ChatRfHopLabelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const uiKey = meshcoreChatHopUiKey(msg);
  const corrected = useSyncExternalStore(
    subscribeMeshcoreHopCorrected,
    () => isMeshcoreHopCorrected(uiKey),
    () => false,
  );
  const { className, refined } = chatRfHopLabelPresentation(corrected, reduceMotion);
  const title = refined
    ? t('chatPanel.hopCountRefinedFromRf')
    : t('nodeDetailModal.hopsFromRoutingTitle');

  return (
    <span className={className} title={title} aria-label={title}>
      {t('nodeDetailModal.hopLabel', { count: rxHops })}
    </span>
  );
}
