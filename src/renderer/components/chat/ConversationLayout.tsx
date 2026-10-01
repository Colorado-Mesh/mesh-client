import type { ReactNode } from 'react';
import { useEffect, useRef } from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Phones and very narrow windows: one pane at a time (list, then conversation). */
export const CONVERSATION_COMPACT_QUERY = '(max-width: 767px)';
/** Below this the side panel (members) opens as a sheet over the conversation instead of docking. */
export const CONVERSATION_SIDE_OVERLAY_QUERY = '(max-width: 1279px)';

export interface ConversationLayoutMode {
  compact: boolean;
  sideOverlay: boolean;
}

/** Layout mode for list + conversation + side panel screens (RRC, MeshCore Rooms). */
export function useConversationLayoutMode(): ConversationLayoutMode {
  const compact = useMediaQuery(CONVERSATION_COMPACT_QUERY);
  const sideOverlay = useMediaQuery(CONVERSATION_SIDE_OVERLAY_QUERY);
  return { compact, sideOverlay: compact || sideOverlay };
}

export interface ConversationLayoutProps {
  mode: ConversationLayoutMode;
  /** Room or hub list, including its own header. */
  list: ReactNode;
  listLabel: string;
  /** Wide windows: whether the list column is shown. */
  listOpen: boolean;
  /** Compact windows: which pane fills the panel. */
  compactPane: 'list' | 'conversation';
  conversation: ReactNode;
  /** Preserve browser forms and scroll when compact navigation returns to the list. */
  keepConversationMounted?: boolean;
  /** Optional side panel (members), docked when wide and a sheet when narrow. */
  side?: ReactNode;
  sideLabel?: string;
  sideOpen?: boolean;
  /** Docked width: `narrow` (224px) for member lists, `wide` (288px) for settings and details. */
  sideWidth?: 'narrow' | 'wide';
  /** Closes the side sheet (backdrop click or Escape) in overlay mode. */
  onCloseSide?: () => void;
  closeSideLabel?: string;
}

/**
 * One list column, the conversation, and an optional side panel (v6 answer to the "four side
 * panels" RRC layout). Wide: list | conversation | side. Medium: side becomes a sheet. Compact
 * (phones): the list and the conversation take turns filling the panel.
 */
export function ConversationLayout({
  mode,
  list,
  listLabel,
  listOpen,
  compactPane,
  conversation,
  keepConversationMounted = false,
  side,
  sideLabel,
  sideOpen = false,
  sideWidth = 'narrow',
  onCloseSide,
  closeSideLabel,
}: ConversationLayoutProps) {
  const { compact, sideOverlay } = mode;
  const showList = compact ? compactPane === 'list' : listOpen;
  const showConversation = !compact || compactPane === 'conversation';
  const showSide = side !== undefined && sideOpen && showConversation;
  const sideAsSheet = showSide && sideOverlay;

  useEffect(() => {
    if (!sideAsSheet || !onCloseSide) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseSide();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [sideAsSheet, onCloseSide]);

  // The sheet covers the list and conversation, so those go inert (below) and keyboard focus
  // moves into the sheet, then back to where it was when the sheet closes.
  const sheetRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!sideAsSheet) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sheet = sheetRef.current;
    (sheet?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? sheet)?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [sideAsSheet]);

  return (
    <div
      className="bg-deep-black border-ink-800 relative flex h-full min-h-0 w-full min-w-0 overflow-hidden rounded-xl border"
      data-layout={compact ? 'compact' : sideOverlay ? 'medium' : 'wide'}
    >
      {showList && (
        <aside
          aria-label={listLabel}
          inert={sideAsSheet}
          className={`border-ink-800 flex min-h-0 flex-col ${
            compact ? 'w-full' : 'w-72 shrink-0 border-r'
          }`}
        >
          {list}
        </aside>
      )}
      {(showConversation || keepConversationMounted) && (
        <section
          hidden={!showConversation}
          inert={sideAsSheet || !showConversation}
          className={`min-h-0 min-w-0 flex-1 flex-col ${showConversation ? 'flex' : 'hidden'}`}
        >
          {conversation}
        </section>
      )}
      {showSide &&
        (sideAsSheet ? (
          <>
            <button
              type="button"
              tabIndex={-1}
              aria-label={closeSideLabel}
              className="bg-app-bg/60 absolute inset-0 z-10 cursor-default"
              onClick={onCloseSide}
            />
            <aside
              ref={sheetRef}
              role="dialog"
              aria-label={sideLabel}
              tabIndex={-1}
              className="bg-deep-black shadow-level-4 border-ink-800 absolute inset-y-0 right-0 z-20 flex min-h-0 w-[min(18rem,85%)] flex-col border-l outline-none"
            >
              {side}
            </aside>
          </>
        ) : (
          <aside
            aria-label={sideLabel}
            className={`border-ink-800 flex min-h-0 shrink-0 flex-col border-l ${
              sideWidth === 'wide' ? 'w-72' : 'w-56'
            }`}
          >
            {side}
          </aside>
        ))}
    </div>
  );
}
