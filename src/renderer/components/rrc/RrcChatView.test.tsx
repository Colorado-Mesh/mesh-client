import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { rrcNickColorClass } from '@/renderer/lib/rrcNickColor';
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

describe('RrcChatView IRC layout', () => {
  beforeEach(() => {
    mockIsAtEnd = true;
    mockScrollToEnd.mockClear();
  });

  it('renders <nick> body on one line without block wrappers in the line', () => {
    render(
      <RrcChatView
        {...baseProps}
        messages={[makeMsg({ id: '1', body: 'hello', nickname: 'nv0n' })]}
      />,
    );
    const line = screen.getByTestId('rrc-chat-line');
    expect(line.textContent).toMatch(/<nv0n>\s*hello/);
    expect(line.querySelector('.min-w-0')?.querySelector('div')).toBeNull();
    expect(line.innerHTML).toContain(rrcNickColorClass('nv0n'));
  });

  it('highlights self @nick in IRC bold red', () => {
    render(
      <RrcChatView
        {...baseProps}
        nickname="nv0n"
        messages={[makeMsg({ id: '1', body: 'hey @nv0n check', nickname: 'Zeva' })]}
      />,
    );
    const el = screen.getByText('@nv0n');
    expect(el.tagName).toBe('SPAN');
    expect(el.className).toContain('font-bold');
    expect(el.className).toContain('text-red-500');
    expect(el.className).not.toMatch(/bg-yellow/);
  });

  it('renders [whispers] inbound notice as room-style <nick> body', () => {
    render(
      <RrcChatView
        {...baseProps}
        activeRoom="[whispers]"
        messages={[
          makeMsg({
            id: '1',
            room: '[whispers]',
            kind: 'notice',
            body: 'psst',
            nickname: 'Zeva',
          }),
        ]}
      />,
    );
    const line = screen.getByTestId('rrc-chat-line');
    expect(line.textContent).toMatch(/<Zeva>\s*psst/);
    expect(line.textContent).not.toMatch(/-Zeva-/);
    expect(line.innerHTML).toContain(rrcNickColorClass('Zeva'));
    expect(line.className).toContain('text-amber-50/90');
  });

  it('hides empty system/notice rows', () => {
    render(
      <RrcChatView
        {...baseProps}
        messages={[
          makeMsg({ id: '1', body: '', kind: 'system', nickname: null }),
          makeMsg({ id: '2', body: 'kept', nickname: 'alice' }),
        ]}
      />,
    );
    expect(screen.getByText(/kept/)).toBeInTheDocument();
    expect(screen.getAllByTestId('rrc-chat-line')).toHaveLength(1);
  });

  it('renders legacy → whisper echo as <selfNick> without arrows', () => {
    render(
      <RrcChatView
        {...baseProps}
        activeRoom="[whispers]"
        nickname="nv0n"
        messages={[
          makeMsg({
            id: '1',
            kind: 'system',
            body: '→ Zeva: hi there',
            nickname: null,
            sender_hash: null,
            room: '[whispers]',
          }),
        ]}
      />,
    );
    const line = screen.getByTestId('rrc-chat-line');
    expect(line.textContent).toMatch(/<nv0n>\s*hi there/);
    expect(line.textContent).not.toContain('→');
    expect(line.className).toContain('text-amber-50/90');
    expect(line.innerHTML).toContain(rrcNickColorClass('nv0n'));
  });

  it('renders outbound whisper msg as room-style <selfNick>', () => {
    render(
      <RrcChatView
        {...baseProps}
        activeRoom="[whispers]"
        nickname="nv0n"
        messages={[
          makeMsg({
            id: '1',
            room: '[whispers]',
            kind: 'msg',
            body: 'testing',
            nickname: 'nv0n',
            dst_hash: 'aa'.repeat(16),
          }),
        ]}
      />,
    );
    const line = screen.getByTestId('rrc-chat-line');
    expect(line.textContent).toMatch(/<nv0n>\s*testing/);
    expect(line.textContent).not.toContain('→');
  });

  it('renders /me action with colored nick', () => {
    render(
      <RrcChatView
        {...baseProps}
        messages={[makeMsg({ id: '1', kind: 'action', body: 'waves', nickname: 'Zeva' })]}
      />,
    );
    const line = screen.getByTestId('rrc-chat-line');
    expect(line.textContent).toMatch(/\*\s*Zeva\s+waves/);
    expect(line.innerHTML).toContain(rrcNickColorClass('Zeva'));
  });
});

describe('RrcChatView mention completer', () => {
  beforeEach(() => {
    mockIsAtEnd = true;
    mockScrollToEnd.mockClear();
    hydrateAxeThemeColors(document.documentElement);
  });

  it('shows listbox and inserts @Zeva on select', async () => {
    const user = userEvent.setup();
    const members = [{ identity_hash: 'aa'.repeat(16), nickname: 'Zeva' }];

    function Harness() {
      const [draft, setDraft] = useState('');
      return (
        <RrcChatView
          {...baseProps}
          draft={draft}
          onDraftChange={setDraft}
          members={members}
          messages={[]}
        />
      );
    }

    const { container } = render(<Harness />);
    const box = screen.getByRole('textbox');
    await user.type(box, '@ze');
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
    const combo = screen.getByRole('combobox');
    expect(combo).toHaveAttribute('aria-expanded', 'true');
    expect(combo).toHaveAttribute('aria-controls', 'rrc-mention-listbox');
    await user.click(screen.getByRole('option', { name: /Zeva/i }));
    expect(box).toHaveValue('@Zeva ');
    expect((box as HTMLTextAreaElement).value).not.toContain('@[');
  });

  it('completes @ from provided room members', async () => {
    const user = userEvent.setup();
    const members = [{ identity_hash: 'aa'.repeat(16), nickname: 'Zeva' }];

    function Harness() {
      const [draft, setDraft] = useState('');
      return (
        <RrcChatView
          {...baseProps}
          activeRoom="[whispers]"
          draft={draft}
          onDraftChange={setDraft}
          members={members}
          messages={[]}
        />
      );
    }

    render(<Harness />);
    const box = screen.getByRole('textbox');
    await user.type(box, '@ze');
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('option', { name: /Zeva/i }));
    expect(box).toHaveValue('@Zeva ');
  });

  it('Tab cycles nicks without narrowing the original prefix', async () => {
    const user = userEvent.setup();
    const members = [
      { identity_hash: 'aa'.repeat(16), nickname: 'Zeva' },
      { identity_hash: 'bb'.repeat(16), nickname: 'Zoe' },
    ];

    function Harness() {
      const [draft, setDraft] = useState('');
      return (
        <RrcChatView
          {...baseProps}
          draft={draft}
          onDraftChange={setDraft}
          members={members}
          messages={[]}
        />
      );
    }

    render(<Harness />);
    const box = screen.getByRole('textbox');
    await user.type(box, '@z');
    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    await user.keyboard('{Tab}');
    expect(box).toHaveValue('@Zeva ');
    await user.keyboard('{Tab}');
    expect(box).toHaveValue('@Zoe ');
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

  it('keeps Chat/Rooms flex + overflow-anchor stream classes', () => {
    render(<RrcChatView {...baseProps} messages={[makeMsg({ id: '1', body: 'one' })]} />);
    const stream = screen.getByTestId('rrc-message-stream');
    expect(stream).toHaveClass(
      'overflow-y-auto',
      'overscroll-contain',
      'min-h-0',
      '[overflow-anchor:none]',
    );
    expect(stream.parentElement).toHaveClass('min-h-0', 'flex-1');
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

  it('follows when the latest id changes at a fixed list length (history cap)', async () => {
    const firstBatch = [
      makeMsg({ id: '1', body: 'old' }),
      makeMsg({ id: '2', body: 'mid' }),
      makeMsg({ id: '3', body: 'newer' }),
    ];
    const { rerender } = render(<RrcChatView {...baseProps} isActive messages={firstBatch} />);
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });
    mockScrollToEnd.mockClear();

    // Same length, new tail id — mirrors MAX_MESSAGES_PER_ROOM slice on busy rooms.
    rerender(
      <RrcChatView
        {...baseProps}
        isActive
        messages={[
          makeMsg({ id: '2', body: 'mid' }),
          makeMsg({ id: '3', body: 'newer' }),
          makeMsg({ id: '4', body: 'newest' }),
        ]}
      />,
    );
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });
  });

  it('does not follow appends while the window is visible but unfocused', async () => {
    const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      const { rerender } = render(
        <RrcChatView {...baseProps} isActive messages={[makeMsg({ id: '1', body: 'one' })]} />,
      );
      await waitFor(() => {
        expect(mockScrollToEnd).toHaveBeenCalled();
      });
      mockScrollToEnd.mockClear();

      hasFocusSpy.mockReturnValue(false);
      fireEvent(window, new Event('blur'));
      rerender(
        <RrcChatView
          {...baseProps}
          isActive
          messages={[makeMsg({ id: '1', body: 'one' }), makeMsg({ id: '2', body: 'two' })]}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(mockScrollToEnd).not.toHaveBeenCalled();
    } finally {
      hasFocusSpy.mockRestore();
    }
  });

  it('follows appends when focused and pinned', async () => {
    const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      const { rerender } = render(
        <RrcChatView {...baseProps} isActive messages={[makeMsg({ id: '1', body: 'one' })]} />,
      );
      await waitFor(() => {
        expect(mockScrollToEnd).toHaveBeenCalled();
      });
      mockScrollToEnd.mockClear();

      rerender(
        <RrcChatView
          {...baseProps}
          isActive
          messages={[makeMsg({ id: '1', body: 'one' }), makeMsg({ id: '2', body: 'two' })]}
        />,
      );
      await waitFor(() => {
        expect(mockScrollToEnd).toHaveBeenCalled();
      });
    } finally {
      hasFocusSpy.mockRestore();
    }
  });

  it('re-follows when focus returns while pinned', async () => {
    const hasFocusSpy = vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    try {
      render(
        <RrcChatView {...baseProps} isActive messages={[makeMsg({ id: '1', body: 'one' })]} />,
      );
      await waitFor(() => {
        expect(mockScrollToEnd).toHaveBeenCalled();
      });
      mockScrollToEnd.mockClear();

      hasFocusSpy.mockReturnValue(false);
      fireEvent(window, new Event('blur'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(mockScrollToEnd).not.toHaveBeenCalled();

      hasFocusSpy.mockReturnValue(true);
      fireEvent(window, new Event('focus'));
      await waitFor(() => {
        expect(mockScrollToEnd).toHaveBeenCalled();
      });
    } finally {
      hasFocusSpy.mockRestore();
    }
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

  it('scrolls to end when hub changes with the same room name', async () => {
    const hubA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const hubB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const { rerender } = render(
      <RrcChatView
        {...baseProps}
        hubDestHash={hubA}
        activeRoom="#general"
        messages={[makeMsg({ id: '1', body: 'a', room: '#general' })]}
      />,
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
        hubDestHash={hubB}
        activeRoom="#general"
        messages={[makeMsg({ id: '2', body: 'b', room: '#general' })]}
      />,
    );
    await waitFor(() => {
      expect(mockScrollToEnd).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('rrc.jumpToLatest')).not.toBeInTheDocument();
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
