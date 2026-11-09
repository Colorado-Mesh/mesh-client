import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import {
  type ChatMessageRouteView,
  formatChatMessageRouteTooltip,
} from '@/renderer/lib/chatMessageRouteView';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useReduceMotion } from '@/renderer/lib/icons/iconMotionContext';
import {
  computeInstantTooltipPosition,
  type InstantTooltipPosition,
} from '@/renderer/lib/instantTooltipPosition';
import {
  isMeshcoreHopCorrected,
  meshcoreChatHopUiKey,
  subscribeMeshcoreHopCorrected,
} from '@/renderer/lib/meshcoreLateRfHopEnrichment';
import type { MessageRouteDetail } from '@/renderer/lib/radio/BaseRadioProvider';
import type { ChatMessage } from '@/renderer/lib/types';

import { InstantTooltipBubble } from './InstantTooltipBubble';

export interface ChatRfHopLabelProps {
  rxHops: number;
  msg: ChatMessage;
  /** Sender as shown in the bubble header (route tooltip "From" line). */
  senderName: string;
  /** What this protocol's packets record about relays (`ProtocolCapabilities`). */
  routeDetail: MessageRouteDetail;
  /** Capture lookup + name resolution; called on hover/focus only, never per render. */
  describeRoute?: (msg: ChatMessage) => ChatMessageRouteView | undefined;
}

/** Class/title for the hop pill when a late RF correction mark is active. */
export function chatRfHopLabelPresentation(
  corrected: boolean,
  reduceMotion: boolean,
): { className: string; refined: boolean } {
  // ink-400 (#93a0b7) on chat ink-800 (#212d40) keeps 4.5:1+ for text-2xs.
  if (!corrected) {
    return {
      className: 'text-2xs text-ink-400 transition-colors duration-500',
      refined: false,
    };
  }
  if (reduceMotion) {
    return {
      className: 'text-2xs text-ink-400 transition-colors duration-500',
      refined: true,
    };
  }
  return {
    className: 'text-2xs text-orange-400/80 transition-colors duration-500',
    refined: true,
  };
}

/**
 * Incoming RF hop count. Hover, focus or tap shows how the message arrived (MeshCore relay
 * path, Meshtastic last relay, or why no route is known). Briefly accents when late event 136
 * corrected a stored value.
 */
export function ChatRfHopLabel({
  rxHops,
  msg,
  senderName,
  routeDetail,
  describeRoute,
}: ChatRfHopLabelProps) {
  const { t } = useTranslation();
  const reduceMotion = useReduceMotion();
  const uiKey = meshcoreChatHopUiKey(msg);
  const corrected = useSyncExternalStore(
    subscribeMeshcoreHopCorrected,
    () => isMeshcoreHopCorrected(uiKey),
    () => false,
  );
  const { className, refined } = chatRfHopLabelPresentation(corrected, reduceMotion);
  const [tooltip, setTooltip] = useState<{ text: string; pos: InstantTooltipPosition } | null>(
    null,
  );
  const ref = useRef<HTMLButtonElement>(null);
  const bubbleId = useId();
  const hopsText = t('nodeDetailModal.hopLabel', { count: rxHops });

  const show = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    let view: ChatMessageRouteView | undefined;
    // Looked up even at 0 hops: an exactly matched capture outranks the stored count.
    if (describeRoute) {
      try {
        view = describeRoute(msg);
      } catch (e) {
        // The tooltip still explains the hop count; the route line falls back to "not available".
        console.warn('[ChatRfHopLabel] route lookup failed ' + errLikeToLogString(e));
      }
    }
    const text = formatChatMessageRouteTooltip(t, {
      hops: rxHops,
      senderName,
      routeDetail,
      view,
      refined,
    });
    setTooltip({ text, pos: computeInstantTooltipPosition(rect) });
  };
  const hide = () => {
    setTooltip(null);
  };

  const open = tooltip != null;
  // A fixed bubble would detach from the pill when the chat list scrolls under it.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => {
      setTooltip(null);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-instant-tooltip-managed=""
        className={`${className} rounded-badge focus-visible:outline-brand-green cursor-help focus-visible:outline-2 focus-visible:outline-offset-2`}
        aria-label={t('chatPanel.messageRoute.pillAriaLabel', { hops: hopsText })}
        aria-describedby={open ? bubbleId : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        // Touch WebViews do not focus a tapped button; tapping shows the route instead.
        onClick={show}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) {
            e.stopPropagation();
            hide();
          }
        }}
      >
        {hopsText}
      </button>
      {tooltip &&
        createPortal(
          <InstantTooltipBubble id={bubbleId} text={tooltip.text} pos={tooltip.pos} />,
          document.body,
        )}
    </>
  );
}
