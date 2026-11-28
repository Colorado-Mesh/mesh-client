/**
 * Mobile override of `src/renderer/components/chat/ConversationLayout.tsx` (Rooms, RRC, Nomad).
 * - Pane mode comes from the mobile viewport: two panes from 640px of usable width, so the
 *   unfolded iPhone Duo (669pt portrait) and Android book foldables show list + conversation.
 * - On a separating vertical fold (book posture, iPhone Duo partly open) the list column ends at
 *   the hinge with a gutter, so neither pane is split by it.
 * The desktop component renders unchanged inside a `display: contents` wrapper.
 */
import { type CSSProperties, useLayoutEffect, useRef } from 'react';

import {
  ConversationLayout as DesktopConversationLayout,
  type ConversationLayoutMode,
  type ConversationLayoutProps,
  useConversationLayoutMode as useDesktopConversationLayoutMode,
} from '@/renderer/components/chat/ConversationLayout';

import { type FoldRect, useMobileViewport } from '../../platform/mobileViewport';

export * from '@/renderer/components/chat/ConversationLayout';

/** Side panel docks only at this usable width or wider (matches the desktop overlay query). */
const SIDE_DOCK_MIN_WIDTH = 1280;
/** Minimum list column width when it is aligned to a fold (keeps rows readable). */
const FOLD_LIST_MIN_PX = 240;

export function useConversationLayoutMode(): ConversationLayoutMode {
  const desktop = useDesktopConversationLayoutMode();
  const viewport = useMobileViewport();
  if (!viewport.isMobile) return desktop;
  const compact = viewport.panes === 1;
  return { compact, sideOverlay: compact || viewport.usableWidth < SIDE_DOCK_MIN_WIDTH };
}

/** List column style that ends at a vertical separating fold, or null for the default width. */
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

export function ConversationLayout(props: ConversationLayoutProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewport = useMobileViewport();
  const { compact } = props.mode;
  const { listOpen } = props;

  useLayoutEffect(() => {
    const layout = hostRef.current?.firstElementChild;
    if (!(layout instanceof HTMLElement)) return;
    // The conversation list is the layout's first child when shown (the side panel comes last).
    const list = layout.querySelector<HTMLElement>(':scope > aside:first-child');
    if (!list) return;
    const rect = layout.getBoundingClientRect();
    const style =
      compact || !listOpen ? null : foldAlignedListStyle(viewport.fold, rect.left, rect.width);
    list.style.width = style ? `${String(style.width)}px` : '';
    list.style.paddingInlineEnd = style ? `${String(style.paddingInlineEnd)}px` : '';
    list.style.flexShrink = style ? '0' : '';
    if (style) layout.dataset.foldSplit = 'true';
    else delete layout.dataset.foldSplit;
  }, [compact, listOpen, viewport]);

  return (
    <div ref={hostRef} className="contents">
      <DesktopConversationLayout {...props} />
    </div>
  );
}
