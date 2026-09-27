import type { ReactNode } from 'react';
import { useEffect } from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';

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

  return (
    <div
      className="bg-deep-black relative flex h-full min-h-0 w-full min-w-0 overflow-hidden rounded-xl border border-zinc-800"
      data-layout={compact ? 'compact' : sideOverlay ? 'medium' : 'wide'}
    >
      {showList && (
        <aside
          aria-label={listLabel}
          className={`flex min-h-0 flex-col border-zinc-800 ${
            compact ? 'w-full' : 'w-72 shrink-0 border-r'
          }`}
        >
          {list}
        </aside>
      )}
      {showConversation && (
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">{conversation}</section>
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
              aria-label={sideLabel}
              className="bg-deep-black shadow-level-4 absolute inset-y-0 right-0 z-20 flex min-h-0 w-[min(18rem,85%)] flex-col border-l border-zinc-800"
            >
              {side}
            </aside>
          </>
        ) : (
          <aside
            aria-label={sideLabel}
            className={`flex min-h-0 shrink-0 flex-col border-l border-zinc-800 ${
              sideWidth === 'wide' ? 'w-72' : 'w-56'
            }`}
          >
            {side}
          </aside>
        ))}
    </div>
  );
}
