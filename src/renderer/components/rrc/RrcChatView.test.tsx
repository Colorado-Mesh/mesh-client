import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import { estimateRrcRowHeight, RrcChatView } from './RrcChatView';

const mockScrollToEnd = vi.fn();
let mockIsAtEnd = true;

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: Record<string, unknown> & { count: number }) => {
    const count = opts.count;
    return {
      getVirtualItems: () =>
        Array.from({ length: count }, (_, index) => ({
          index,
          key: index,
          start: index * 22,
        })),
      getTotalSize: () => count * 22,
      measureElement: () => {},
      containerRef: { current: null },
      isAtEnd: () => mockIsAtEnd,
      scrollToEnd: mockScrollToEnd,
      scrollToIndex: vi.fn(),
      scrollDirection: 'forward' as const,
      shouldAdjustScrollPositionOnItemSizeChange: undefined as
        ((item: { index: number }) => boolean) | undefined,
    };
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

function makeMsg(
  partial: Partial<RrcChatMessage> & Pick<RrcChatMessage, 'id' | 'body'>,
): RrcChatMessage {
  return {
    room: '#general',
    kind: 'msg',
    timestamp: Date.now(),
    nickname: 'alice',
    sender_hash: 'bb'.repeat(16),
    ...partial,
  };
}

const baseProps = {
  connected: true as const,
  activeRoom: '#general',
  showTimestamps: false,
  draft: '',
  onDraftChange: vi.fn(),
  onSend: vi.fn(),
  canSend: true,
  isMuted: false,
};

describe('estimateRrcRowHeight', () => {
  it('scales with wrapped body length', () => {
    expect(estimateRrcRowHeight(makeMsg({ id: '1', body: 'hi' }))).toBe(22);
    expect(estimateRrcRowHeight(makeMsg({ id: '2', body: 'x'.repeat(160) }))).toBe(42);
    expect(estimateRrcRowHeight(undefined)).toBe(22);
  });
});

describe('RrcChatView alwaysShowMessageActions', () => {
  beforeEach(() => {
    mockIsAtEnd = true;
    mockScrollToEnd.mockClear();
  });

  it('keeps copy control visible when alwaysShowMessageActions is set', () => {
    render(
      <RrcChatView
        {...baseProps}
        messages={[makeMsg({ id: '1', body: 'hello' })]}
        alwaysShowMessageActions
      />,
    );
    const btn = screen.getByLabelText('rrc.copyMessage');
    expect(btn.className).toContain('opacity-100');
    expect(btn.className).not.toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
  });

  it('uses hover/focus-within visibility for copy by default', () => {
    render(<RrcChatView {...baseProps} messages={[makeMsg({ id: '1', body: 'hello' })]} />);
    const btn = screen.getByLabelText('rrc.copyMessage');
    expect(btn.className).toMatch(/(?:^|\s)opacity-0(?:\s|$)/);
    expect(btn.className).toContain('group-focus-within:opacity-100');
    expect(btn.className).toContain('group-hover:opacity-100');
  });
});

describe('RrcChatView stick-to-bottom', () => {
  beforeEach(() => {
    mockIsAtEnd = true;
    mockScrollToEnd.mockClear();
  });

  it('scrolls to end when a message appends while pinned', async () => {
    const { rerender } = render(
      <RrcChatView {...baseProps} messages={[makeMsg({ id: '1', body: 'one' })]} />,
    );
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });
    mockScrollToEnd.mockClear();

    rerender(
      <RrcChatView
        {...baseProps}
        messages={[makeMsg({ id: '1', body: 'one' }), makeMsg({ id: '2', body: 'two' })]}
      />,
    );
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });
  });

  it('does not follow appends when scrolled up and shows Jump to Latest', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <RrcChatView {...baseProps} messages={[makeMsg({ id: '1', body: 'one' })]} />,
    );
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });

    mockIsAtEnd = false;
    fireEvent.scroll(screen.getByTestId('rrc-message-stream'));
    expect(screen.getByLabelText('rrc.jumpToLatest')).toBeInTheDocument();

    mockScrollToEnd.mockClear();
    rerender(
      <RrcChatView
        {...baseProps}
        messages={[makeMsg({ id: '1', body: 'one' }), makeMsg({ id: '2', body: 'two' })]}
      />,
    );
    // Allow the follow effect to run; it must not scroll while unpinned.
    await waitFor(() => {
      expect(screen.getByLabelText('rrc.jumpToLatest')).toBeInTheDocument();
    });
    expect(mockScrollToEnd).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText('rrc.jumpToLatest'));
    expect(mockScrollToEnd).toHaveBeenCalledWith({ behavior: 'smooth' });
  });

  it('scrolls to end when activeRoom changes', async () => {
    const { rerender } = render(
      <RrcChatView {...baseProps} messages={[makeMsg({ id: '1', body: 'a', room: '#general' })]} />,
    );
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });
    mockScrollToEnd.mockClear();

    rerender(
      <RrcChatView
        {...baseProps}
        activeRoom="#ops"
        messages={[makeMsg({ id: '2', body: 'b', room: '#ops' })]}
      />,
    );
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });
  });

  it('restores scrollTop on tab re-entry when not pinned', () => {
    const { rerender } = render(
      <RrcChatView {...baseProps} isActive messages={[makeMsg({ id: '1', body: 'one' })]} />,
    );
    const stream = screen.getByTestId('rrc-message-stream');
    Object.defineProperty(stream, 'scrollTop', {
      value: 500,
      writable: true,
      configurable: true,
    });
    mockIsAtEnd = false;
    fireEvent.scroll(stream);

    rerender(
      <RrcChatView
        {...baseProps}
        isActive={false}
        messages={[makeMsg({ id: '1', body: 'one' })]}
      />,
    );
    (stream as HTMLDivElement).scrollTop = 0;

    mockScrollToEnd.mockClear();
    rerender(
      <RrcChatView {...baseProps} isActive messages={[makeMsg({ id: '1', body: 'one' })]} />,
    );

    expect((stream as HTMLDivElement).scrollTop).toBe(500);
  });

  it('scrolls to end on tab re-entry when pinned', () => {
    const { rerender } = render(
      <RrcChatView {...baseProps} isActive messages={[makeMsg({ id: '1', body: 'one' })]} />,
    );
    const stream = screen.getByTestId('rrc-message-stream');
    Object.defineProperty(stream, 'scrollTop', {
      value: 400,
      writable: true,
      configurable: true,
    });
    // Stay pinned (no scroll event — isPinnedToBottomRef defaults true; isAtEnd true).

    rerender(
      <RrcChatView
        {...baseProps}
        isActive={false}
        messages={[makeMsg({ id: '1', body: 'one' })]}
      />,
    );

    mockScrollToEnd.mockClear();
    mockScrollToEnd.mockImplementation(() => {
      (stream as HTMLDivElement).scrollTop = 900;
    });

    rerender(
      <RrcChatView {...baseProps} isActive messages={[makeMsg({ id: '1', body: 'one' })]} />,
    );

    expect(mockScrollToEnd).toHaveBeenCalled();
    expect((stream as HTMLDivElement).scrollTop).toBe(900);
  });
});
