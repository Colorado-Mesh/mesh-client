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
