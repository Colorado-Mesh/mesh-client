import { fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import {
  CONVERSATION_COMPACT_QUERY,
  CONVERSATION_SIDE_OVERLAY_QUERY,
  ConversationLayout,
  type ConversationLayoutMode,
  useConversationLayoutMode,
} from './ConversationLayout';

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

afterEach(() => {
  if (originalMatchMedia) Object.defineProperty(window, 'matchMedia', originalMatchMedia);
  else Reflect.deleteProperty(window, 'matchMedia');
});

function renderLayout(
  mode: ConversationLayoutMode,
  opts: Partial<{
    compactPane: 'list' | 'conversation';
    sideOpen: boolean;
    listOpen: boolean;
  }> = {},
  onCloseSide = vi.fn(),
) {
  return render(
    <ConversationLayout
      mode={mode}
      list={<p>room list</p>}
      listLabel="Rooms and hubs"
      listOpen={opts.listOpen ?? true}
      compactPane={opts.compactPane ?? 'conversation'}
      conversation={<p>messages</p>}
      side={<p>member list</p>}
      sideLabel="Members"
      sideOpen={opts.sideOpen ?? true}
      onCloseSide={onCloseSide}
      closeSideLabel="Hide members"
    />,
  );
}

describe('useConversationLayoutMode', () => {
  it('maps the media queries to wide, medium and compact', () => {
    stubMatchMedia([]);
    expect(renderHook(() => useConversationLayoutMode()).result.current).toEqual({
      compact: false,
      sideOverlay: false,
    });
    stubMatchMedia([CONVERSATION_SIDE_OVERLAY_QUERY]);
    expect(renderHook(() => useConversationLayoutMode()).result.current).toEqual({
      compact: false,
      sideOverlay: true,
    });
    stubMatchMedia([CONVERSATION_COMPACT_QUERY]);
    expect(renderHook(() => useConversationLayoutMode()).result.current).toEqual({
      compact: true,
      sideOverlay: true,
    });
  });
});

describe('ConversationLayout', () => {
  it('docks list, conversation and side panel on wide windows', async () => {
    const { container } = renderLayout({ compact: false, sideOverlay: false });
    expect(screen.getByRole('complementary', { name: 'Rooms and hubs' })).toBeInTheDocument();
    expect(screen.getByText('messages')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Members' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hide members' })).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('hides the list column when closed on wide windows', () => {
    renderLayout({ compact: false, sideOverlay: false }, { listOpen: false });
    expect(screen.queryByText('room list')).not.toBeInTheDocument();
    expect(screen.getByText('messages')).toBeInTheDocument();
  });

  it('opens the side panel as a sheet that closes on backdrop or Escape', () => {
    const onCloseSide = vi.fn();
    renderLayout({ compact: false, sideOverlay: true }, {}, onCloseSide);
    expect(screen.getByText('member list')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide members' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseSide).toHaveBeenCalledTimes(2);
  });

  it('moves keyboard focus into the sheet, makes the covered panes inert, and returns focus', () => {
    const layout = (sideOpen: boolean) => (
      <ConversationLayout
        mode={{ compact: false, sideOverlay: true }}
        list={<button type="button">Room</button>}
        listLabel="Rooms and hubs"
        listOpen
        compactPane="conversation"
        conversation={<button type="button">Disconnect</button>}
        side={<button type="button">Refresh members</button>}
        sideLabel="Members"
        sideOpen={sideOpen}
        onCloseSide={vi.fn()}
        closeSideLabel="Hide members"
      />
    );
    const { rerender } = render(layout(false));
    const disconnect = screen.getByRole('button', { name: 'Disconnect' });
    disconnect.focus();

    rerender(layout(true));
    expect(screen.getByRole('dialog', { name: 'Members' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Refresh members' }));
    // Covered by the backdrop, so out of the tab order and hidden from assistive tech.
    expect(disconnect.closest('section')).toHaveAttribute('inert');
    expect(
      screen.getByRole('complementary', { name: 'Rooms and hubs', hidden: true }),
    ).toHaveAttribute('inert');

    rerender(layout(false));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Disconnect' }));
    expect(
      screen.getByRole('button', { name: 'Disconnect' }).closest('section'),
    ).not.toHaveAttribute('inert');
  });

  it('shows one pane at a time on compact windows', () => {
    const { rerender } = renderLayout(
      { compact: true, sideOverlay: true },
      { compactPane: 'list' },
    );
    expect(screen.getByText('room list')).toBeInTheDocument();
    expect(screen.queryByText('messages')).not.toBeInTheDocument();
    expect(screen.queryByText('member list')).not.toBeInTheDocument();
    rerender(
      <ConversationLayout
        mode={{ compact: true, sideOverlay: true }}
        list={<p>room list</p>}
        listLabel="Rooms and hubs"
        listOpen
        compactPane="conversation"
        conversation={<p>messages</p>}
        side={<p>member list</p>}
        sideLabel="Members"
        sideOpen={false}
      />,
    );
    expect(screen.queryByText('room list')).not.toBeInTheDocument();
    expect(screen.getByText('messages')).toBeInTheDocument();
  });
});

it('keeps an opted-in compact browser mounted and inert while returning to its list', () => {
  const mode = { compact: true, sideOverlay: true };
  const props = {
    mode,
    list: <p>Nodes</p>,
    listLabel: 'Nodes',
    listOpen: true,
    conversation: <input aria-label="Micron field" defaultValue="" />,
    keepConversationMounted: true,
  };
  const { rerender } = render(<ConversationLayout {...props} compactPane="conversation" />);
  const field = screen.getByLabelText<HTMLInputElement>('Micron field');
  field.value = 'saved callsign';
  rerender(<ConversationLayout {...props} compactPane="list" />);
  expect(field).not.toBeVisible();
  expect(field.closest('section')).toHaveAttribute('inert');
  rerender(<ConversationLayout {...props} compactPane="conversation" />);
  expect(screen.getByLabelText('Micron field')).toBe(field);
  expect(field).toHaveValue('saved callsign');
  expect(field).toBeVisible();
});

describe('mobile app layout mode', () => {
  afterEach(async () => {
    const { setMobileViewport, DESKTOP_VIEWPORT } = await import('../../lib/mobileViewport');
    setMobileViewport(DESKTOP_VIEWPORT);
  });

  it('desktop keeps the media-query layout when the mobile viewport is not active', () => {
    stubMatchMedia([CONVERSATION_COMPACT_QUERY, CONVERSATION_SIDE_OVERLAY_QUERY]);
    const { result } = renderHook(() => useConversationLayoutMode());
    expect(result.current).toEqual({ compact: true, sideOverlay: true });
  });

  it('mobile: two panes from 640px (unfolded iPhone Duo portrait) even below the desktop breakpoint', async () => {
    stubMatchMedia([CONVERSATION_COMPACT_QUERY, CONVERSATION_SIDE_OVERLAY_QUERY]);
    const { computeMobileViewport, setMobileViewport } = await import('../../lib/mobileViewport');
    setMobileViewport(
      computeMobileViewport({
        usableWidth: 669,
        usableHeight: 900,
        fold: null,
        posture: 'flat',
        keyboardOpen: false,
        keyboardInset: 0,
        previousPanes: null,
      }),
    );
    const { result } = renderHook(() => useConversationLayoutMode());
    expect(result.current).toEqual({ compact: false, sideOverlay: true });
  });

  it('mobile: one pane on the folded iPhone Duo cover screen', async () => {
    stubMatchMedia([]);
    const { computeMobileViewport, setMobileViewport } = await import('../../lib/mobileViewport');
    setMobileViewport(
      computeMobileViewport({
        usableWidth: 382,
        usableHeight: 644,
        fold: null,
        posture: 'flat',
        keyboardOpen: false,
        keyboardInset: 0,
        previousPanes: null,
      }),
    );
    const { result } = renderHook(() => useConversationLayoutMode());
    expect(result.current.compact).toBe(true);
  });
});

describe('foldAlignedListStyle', () => {
  it('ends the list at a vertical separating fold and pads past the hinge', async () => {
    const { foldAlignedListStyle } = await import('./ConversationLayout');
    const fold = {
      left: 475,
      top: 0,
      width: 20,
      height: 900,
      orientation: 'vertical' as const,
      separating: true,
    };
    expect(foldAlignedListStyle(fold, 0, 951)).toEqual({
      width: 495,
      paddingInlineEnd: 20,
      flexShrink: 0,
    });
    // Container offset (e.g. a rail) is subtracted.
    expect(foldAlignedListStyle(fold, 72, 879)?.width).toBe(423);
  });

  it('ignores flat, horizontal, or out-of-range folds', async () => {
    const { foldAlignedListStyle } = await import('./ConversationLayout');
    const base = { left: 475, top: 0, width: 0, height: 900, orientation: 'vertical' as const };
    expect(foldAlignedListStyle({ ...base, separating: false }, 0, 951)).toBeNull();
    expect(
      foldAlignedListStyle({ ...base, orientation: 'horizontal', separating: true }, 0, 951),
    ).toBeNull();
    expect(foldAlignedListStyle({ ...base, left: 100, separating: true }, 0, 951)).toBeNull();
    expect(foldAlignedListStyle(null, 0, 951)).toBeNull();
  });
});
