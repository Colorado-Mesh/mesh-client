import { render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  CONVERSATION_COMPACT_QUERY,
  CONVERSATION_SIDE_OVERLAY_QUERY,
  ConversationLayout,
  useConversationLayoutMode,
} from '@/renderer/components/chat/ConversationLayout';

import {
  computeMobileViewport,
  DESKTOP_VIEWPORT,
  type FoldRect,
  setMobileViewport,
} from '../../platform/mobileViewport';
import { foldAlignedListStyle } from './ConversationLayout';

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, 'matchMedia');

function stubMatchMedia(matching: string[]) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      media: query,
      matches: matching.includes(query),
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function mobile(width: number, height: number, fold: FoldRect | null = null) {
  setMobileViewport(
    computeMobileViewport({
      usableWidth: width,
      usableHeight: height,
      fold,
      posture: fold?.separating ? 'book' : 'flat',
      keyboardOpen: false,
      keyboardInset: 0,
      previousPanes: null,
    }),
  );
}

const DUO_FOLD: FoldRect = {
  left: 475,
  top: 0,
  width: 20,
  height: 669,
  orientation: 'vertical',
  separating: true,
};

afterEach(() => {
  setMobileViewport(DESKTOP_VIEWPORT);
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  else Reflect.deleteProperty(window, 'matchMedia');
});

describe('useConversationLayoutMode (mobile override)', () => {
  it('desktop viewport keeps the media-query layout', () => {
    stubMatchMedia([CONVERSATION_COMPACT_QUERY, CONVERSATION_SIDE_OVERLAY_QUERY]);
    const { result } = renderHook(() => useConversationLayoutMode());
    expect(result.current).toEqual({ compact: true, sideOverlay: true });
  });

  it('two panes from 640px (unfolded iPhone Duo portrait), below the desktop breakpoint', () => {
    stubMatchMedia([CONVERSATION_COMPACT_QUERY, CONVERSATION_SIDE_OVERLAY_QUERY]);
    mobile(669, 900);
    const { result } = renderHook(() => useConversationLayoutMode());
    expect(result.current).toEqual({ compact: false, sideOverlay: true });
  });

  it('one pane on the folded iPhone Duo cover screen', () => {
    stubMatchMedia([]);
    mobile(382, 644);
    const { result } = renderHook(() => useConversationLayoutMode());
    expect(result.current).toEqual({ compact: true, sideOverlay: true });
  });

  it('docks the side panel only on wide tablets', () => {
    stubMatchMedia([]);
    mobile(1366, 1000);
    const { result } = renderHook(() => useConversationLayoutMode());
    expect(result.current).toEqual({ compact: false, sideOverlay: false });
  });
});

describe('foldAlignedListStyle', () => {
  it('ends the list at a vertical separating fold and pads past the hinge', () => {
    expect(foldAlignedListStyle(DUO_FOLD, 0, 951)).toEqual({
      width: 495,
      paddingInlineEnd: 20,
      flexShrink: 0,
    });
    // A container offset (e.g. the navigation rail) is subtracted.
    expect(foldAlignedListStyle(DUO_FOLD, 72, 879)?.width).toBe(423);
  });

  it('ignores flat, horizontal, or out-of-range folds', () => {
    expect(foldAlignedListStyle({ ...DUO_FOLD, separating: false }, 0, 951)).toBeNull();
    expect(foldAlignedListStyle({ ...DUO_FOLD, orientation: 'horizontal' }, 0, 951)).toBeNull();
    expect(foldAlignedListStyle({ ...DUO_FOLD, left: 100 }, 0, 951)).toBeNull();
    expect(foldAlignedListStyle(null, 0, 951)).toBeNull();
  });
});

describe('ConversationLayout (mobile override)', () => {
  const originalRect = Object.getOwnPropertyDescriptor(Element.prototype, 'getBoundingClientRect');
  beforeEach(() => {
    // jsdom has no layout: the conversation container spans the unfolded Duo inner display.
    Element.prototype.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 951, height: 669, right: 951, bottom: 669 }) as DOMRect;
  });
  afterEach(() => {
    if (originalRect)
      Object.defineProperty(Element.prototype, 'getBoundingClientRect', originalRect);
  });

  function renderLayout(compact: boolean) {
    return render(
      <ConversationLayout
        mode={{ compact, sideOverlay: true }}
        list={<p>list</p>}
        listLabel="Rooms"
        listOpen
        compactPane="list"
        conversation={<p>thread</p>}
      />,
    );
  }

  it('aligns the list column to a separating fold and marks the layout', () => {
    stubMatchMedia([]);
    mobile(951, 669, DUO_FOLD);
    const { container } = renderLayout(false);
    const layout = container.querySelector<HTMLElement>('[data-layout]');
    const list = screen.getByRole('complementary', { name: 'Rooms' });
    expect(layout?.dataset.foldSplit).toBe('true');
    expect(list.style.width).toBe('495px');
    expect(list.style.paddingInlineEnd).toBe('20px');
  });

  it('leaves the desktop list width alone without a fold', () => {
    stubMatchMedia([]);
    mobile(951, 669);
    const { container } = renderLayout(false);
    const layout = container.querySelector<HTMLElement>('[data-layout]');
    expect(layout?.dataset.foldSplit).toBeUndefined();
    expect(screen.getByRole('complementary', { name: 'Rooms' }).style.width).toBe('');
  });
});
