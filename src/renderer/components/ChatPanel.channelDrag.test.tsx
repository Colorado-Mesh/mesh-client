import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CHIP_ORDER_DRAG_TYPE } from '../hooks/useChipDragReorder';
import { conversationPrefsStorageKey } from '../lib/conversationPinStorage';
import type { MeshProtocol } from '../lib/types';
import ChatPanel, { type ChatPanelProps } from './ChatPanel';
import { ToastProvider } from './Toast';

vi.mock('../lib/chatNotifications', () => ({
  playMessageNotification: vi.fn(),
  playMecpSiren: vi.fn(),
  playMecpEasAttention: vi.fn(),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: opts.count }, (_, index) => ({ index, key: index, start: index * 96 })),
    getTotalSize: () => opts.count * 96,
    measureElement: () => {},
    resizeItem: () => {},
    containerRef: { current: null },
    isAtEnd: () => true,
    scrollToEnd: vi.fn(),
    scrollToIndex: vi.fn(),
    scrollDirection: 'forward',
    shouldAdjustScrollPositionOnItemSizeChange: undefined,
  }),
}));

const NAMES = ['General', 'Ops', 'Alerts', 'Wx'];

// jsdom has no DragEvent, so fireEvent would build a plain Event and drop clientX.
beforeAll(() => {
  vi.stubGlobal('DragEvent', class extends MouseEvent {});
});
afterAll(() => {
  vi.unstubAllGlobals();
});

function props(protocol: MeshProtocol, extra: Partial<ChatPanelProps> = {}): ChatPanelProps {
  return {
    protocol,
    messages: [],
    channels: NAMES.map((name, index) => ({ index, name })),
    myNodeNum: 1,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: true,
    nodes: new Map(),
    isActive: true,
    ...extra,
  };
}

function renderPanel(protocol: MeshProtocol, extra: Partial<ChatPanelProps> = {}) {
  return render(
    <ToastProvider>
      <ChatPanel {...props(protocol, extra)} />
    </ToastProvider>,
  );
}

const strip = () => screen.getByRole('region', { name: 'Channels' });
const chip = (name: string) => within(strip()).getByRole('button', { name });
const order = () =>
  within(strip())
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label'))
    .filter((label): label is string => label != null && NAMES.includes(label));

function transfer() {
  return {
    setData: vi.fn(),
    effectAllowed: 'none',
    dropEffect: 'none',
    types: [CHIP_ORDER_DRAG_TYPE],
  };
}

/** Drops `name` on the right half of `target` (after it) or the left half (before it). */
function drag(name: string, target: string, side: 'before' | 'after') {
  const data = transfer();
  const goal = chip(target);
  vi.spyOn(goal, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 160,
    width: 60,
    top: 0,
    bottom: 24,
    height: 24,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  });
  const clientX = side === 'after' ? 150 : 110;
  fireEvent.dragStart(chip(name), { dataTransfer: data });
  const accepted = !fireEvent.dragOver(goal, { dataTransfer: data, clientX });
  if (accepted) fireEvent.drop(goal, { dataTransfer: data, clientX });
  fireEvent.dragEnd(chip(name), { dataTransfer: data });
  return accepted;
}

const savedOrder = (protocol: MeshProtocol) =>
  JSON.parse(localStorage.getItem(`mesh-client:chatOrder:${protocol}:1:channels`) ?? 'null') as
    string[] | null;

describe.each<MeshProtocol>(['meshtastic', 'meshcore', 'reticulum'])(
  'ChatPanel channel drag to reorder (%s)',
  (protocol) => {
    beforeEach(() => {
      localStorage.clear();
      vi.mocked(window.electronAPI.chat.outbox.list).mockResolvedValue([]);
    });

    it('moves a chip after or before another and saves display order only', () => {
      const onSend = vi.fn().mockResolvedValue(undefined);
      const { unmount } = renderPanel(protocol, { onSend });
      expect(order()).toEqual(NAMES);
      expect(drag('General', 'Alerts', 'after')).toBe(true);
      expect(order()).toEqual(['Ops', 'Alerts', 'General', 'Wx']);
      expect(savedOrder(protocol)).toEqual(['1', '2', '0', '3']);
      expect(drag('Wx', 'Ops', 'before')).toBe(true);
      expect(order()).toEqual(['Wx', 'Ops', 'Alerts', 'General']);
      unmount();

      // Reload keeps the order; channel indexes (radio slots) are unchanged.
      renderPanel(protocol, { onSend });
      expect(order()).toEqual(['Wx', 'Ops', 'Alerts', 'General']);
      expect(savedOrder(protocol)).toEqual(['3', '1', '2', '0']);
    });

    it('keeps focus on a focused chip after dropping it', () => {
      renderPanel(protocol);
      chip('General').focus();
      drag('General', 'Alerts', 'after');
      expect(order()).toEqual(['Ops', 'Alerts', 'General', 'Wx']);
      expect(chip('General')).toHaveFocus();
    });

    it('keeps the chips a drop passes over mounted', () => {
      renderPanel(protocol);
      const ops = chip('Ops');
      const alerts = chip('Alerts');
      drag('General', 'Alerts', 'after');
      expect(chip('Ops')).toBe(ops);
      expect(chip('Alerts')).toBe(alerts);
    });

    it('refuses a drop when another radio took over the strip mid-drag', () => {
      const { rerender } = renderPanel(protocol);
      const data = transfer();
      fireEvent.dragStart(chip('General'), { dataTransfer: data });
      rerender(
        <ToastProvider>
          <ChatPanel {...props(protocol, { myNodeNum: 2 })} />
        </ToastProvider>,
      );
      const goal = chip('Alerts');
      vi.spyOn(goal, 'getBoundingClientRect').mockReturnValue({
        left: 100,
        right: 160,
        width: 60,
        top: 0,
        bottom: 24,
        height: 24,
        x: 100,
        y: 0,
        toJSON: () => ({}),
      });
      expect(fireEvent.dragOver(goal, { dataTransfer: data, clientX: 150 })).toBe(true);
      fireEvent.drop(goal, { dataTransfer: data, clientX: 150 });
      expect(order()).toEqual(NAMES);
      expect(localStorage.getItem(`mesh-client:chatOrder:${protocol}:2:channels`)).toBeNull();
      expect(savedOrder(protocol)).toBeNull();
    });

    it('does not select a channel by dragging, but a click still selects it', () => {
      renderPanel(protocol);
      expect(chip('General')).toHaveAttribute('aria-pressed', 'true');
      drag('Ops', 'Wx', 'after');
      expect(chip('Ops')).toHaveAttribute('aria-pressed', 'false');
      fireEvent.click(chip('Ops'));
      expect(chip('Ops')).toHaveAttribute('aria-pressed', 'true');
    });

    it('keeps pinned chips first and refuses drops onto them', () => {
      localStorage.setItem(
        conversationPrefsStorageKey(protocol, null),
        JSON.stringify({ pinned: ['ch:2'], archived: [] }),
      );
      renderPanel(protocol);
      expect(order()).toEqual(['Alerts', 'General', 'Ops', 'Wx']);
      expect(chip('Alerts')).not.toHaveAttribute('draggable');
      expect(chip('General')).toHaveAttribute('draggable', 'true');
      expect(drag('Wx', 'Alerts', 'before')).toBe(false);
      expect(order()).toEqual(['Alerts', 'General', 'Ops', 'Wx']);
      expect(savedOrder(protocol)).toBeNull();
    });

    it('keeps a hidden archived channel in its slot', () => {
      localStorage.setItem(
        conversationPrefsStorageKey(protocol, null),
        JSON.stringify({ pinned: [], archived: ['ch:1'] }),
      );
      renderPanel(protocol);
      expect(order()).toEqual(['General', 'Alerts', 'Wx']);
      drag('Wx', 'Alerts', 'before');
      expect(order()).toEqual(['General', 'Wx', 'Alerts']);
      expect(savedOrder(protocol)).toEqual(['0', '1', '3', '2']);
    });

    it('shows the dragged order in the Order chats dialog', async () => {
      renderPanel(protocol);
      drag('General', 'Wx', 'after');
      const button = screen
        .getAllByRole('button', { name: 'Order chats' })
        .find((candidate) => !candidate.hasAttribute('disabled'));
      if (!button) throw new Error('order button not found');
      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
      });
      const dialog = screen.getByRole('dialog', { name: 'Order chats' });
      expect(
        within(dialog)
          .getAllByRole('listitem')
          .map((row) => row.dataset.chatOrderId),
      ).toEqual(['1', '2', '3', '0']);
    });
  },
);

describe('ChatPanel channel drag in DM-only chat', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.chat.outbox.list).mockResolvedValue([]);
  });
  it('has no channel strip to drag (Reticulum chat lists DMs instead)', () => {
    renderPanel('reticulum', { dmOnlyChat: true });
    expect(screen.queryByRole('region', { name: 'Channels' })).not.toBeInTheDocument();
  });
});
