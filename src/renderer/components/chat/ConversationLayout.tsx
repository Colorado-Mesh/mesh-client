import type { CSSProperties, ReactNode, RefObject } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { type FoldRect, useMobileViewport } from '../../lib/mobileViewport';

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

/** Side panel docks only at this usable width or wider (matches the desktop overlay query). */
const MOBILE_SIDE_DOCK_MIN_WIDTH = 1280;

/**
 * Layout mode for list + conversation + side panel screens (RRC, MeshCore Rooms).
 * Desktop uses the media queries above unchanged. The mobile app decides from its viewport state
 * (`mobileViewport.ts`): two panes from 640px of usable width, so foldables and tablets show the
 * list beside the conversation.
 */
export function useConversationLayoutMode(): ConversationLayoutMode {
  const compactQuery = useMediaQuery(CONVERSATION_COMPACT_QUERY);
  const sideOverlayQuery = useMediaQuery(CONVERSATION_SIDE_OVERLAY_QUERY);
  const viewport = useMobileViewport();
  if (viewport.isMobile) {
    const compact = viewport.panes === 1;
    return { compact, sideOverlay: compact || viewport.usableWidth < MOBILE_SIDE_DOCK_MIN_WIDTH };
  }
  return { compact: compactQuery, sideOverlay: compactQuery || sideOverlayQuery };
}

/** Minimum list column width when it is aligned to a fold (keeps rows readable). */
const FOLD_LIST_MIN_PX = 240;

/**
 * On a vertical separating fold (book posture, iPhone Duo partly open), end the list column at
 * the hinge so the list and the conversation each get one side of the screen. Returns the list
 * width plus the gutter that keeps controls off the hinge, or null to use the default width.
 */
export function foldAlignedListStyle(
  fold: FoldRect | null,
  containerLeft: number,
  containerWidth: number,
): CSSProperties | null {
  if (!fold?.separating || fold.orientation !== 'vertical') return null;
  const width = fold.left - containerLeft;
  if (width < FOLD_LIST_MIN_PX || width > containerWidth - FOLD_LIST_MIN_PX) return null;
  return { width: width + fold.width, paddingInlineEnd: fold.width, flexShrink: 0 };
}

function useFoldAlignedListStyle(
  containerRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
): CSSProperties | null {
  const viewport = useMobileViewport();
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!enabled || !viewport.isMobile || !viewport.fold || !el) {
      setStyle(null);
      return;
    }
    const rect = el.getBoundingClientRect();
    setStyle(foldAlignedListStyle(viewport.fold, rect.left, rect.width));
  }, [containerRef, enabled, viewport]);
  return style;
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
  const containerRef = useRef<HTMLDivElement>(null);
  const foldListStyle = useFoldAlignedListStyle(containerRef, !compact && listOpen);
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
      ref={containerRef}
      className="bg-deep-black border-ink-800 relative flex h-full min-h-0 w-full min-w-0 overflow-hidden rounded-xl border"
      data-layout={compact ? 'compact' : sideOverlay ? 'medium' : 'wide'}
      data-fold-split={foldListStyle ? 'true' : undefined}
    >
      {showList && (
        <aside
          aria-label={listLabel}
          inert={sideAsSheet}
          style={foldListStyle ?? undefined}
          className={`border-ink-800 flex min-h-0 flex-col ${
            compact ? 'w-full' : foldListStyle ? 'border-r' : 'w-72 shrink-0 border-r'
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
