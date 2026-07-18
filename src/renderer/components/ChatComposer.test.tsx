import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MESHTASTIC_PAYLOAD_LIMIT } from '@/renderer/lib/chatComposerLimits';
import { draftsStorageKey } from '@/renderer/lib/chatPanelProtocolStorage';

import { ChatComposer } from './ChatComposer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'chatPanel.composePlaceholderDefault': 'Type a message…',
        'chatPanel.composePlaceholderConnectFirst': 'Connect to send',
        'chatPanel.sendButton': 'Send',
        'chatPanel.sendButtonSending': 'Sending…',
        'chatPanel.emojiButton': 'Emoji',
        'chatPanel.insertEmoji': 'Insert emoji',
        'chatPanel.cancelReply': 'Cancel reply',
        'chatPanel.queueButton': 'Queue',
        'chatPanel.replyingTo': 'Replying to',
        'chatPanel.composeLimit.limitHint': `Up to ${opts?.limit} characters per message.`,
        'chatPanel.composeLimit.splitHint': 'Sent as separate packets labeled [1/N], [2/N], …',
        'chatPanel.meshcoreGifButton': 'Insert Giphy GIF',
        'chatPanel.meshcoreGifPlaceholder': 'Giphy URL or id',
        'chatPanel.meshcoreGifSend': 'Send GIF',
        'common.cancel': 'Cancel',
      };
      if (key === 'chatPanel.composeLimit.approaching') {
        return `${opts?.count} / ${opts?.limit}`;
      }
      if (key === 'chatPanel.composeLimit.split') {
        return `${opts?.count} characters · ${opts?.parts} messages`;
      }
      if (key === 'chatPanel.composeLimit.overMax') {
        return `Too long — maximum ${opts?.totalMax} characters (${opts?.maxParts} messages)`;
      }
      if (key === 'chatPanel.composeLimit.sendParts') {
        return `Send ${opts?.count} parts`;
      }
      return map[key] ?? key;
    },
  }),
}));

describe('ChatComposer', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('clears input after successful send', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello room');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith('hello room', { replyId: undefined, chunkIndex: 0 });
    });
    expect(textarea).toHaveValue('');
  });

  it('keeps compose focus after Enter-to-send', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello{Enter}');
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith('hello', { replyId: undefined, chunkIndex: 0 });
    });
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue('');
  });

  it('keeps compose focus after click-to-send', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith('hello', { replyId: undefined, chunkIndex: 0 });
    });
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue('');
  });

  it('preserves text typed during an in-flight send', async () => {
    let resolveSend: (() => void) | undefined;
    const onSendChunk = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'first');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    fireEvent.change(textarea, { target: { value: 'second' } });
    resolveSend?.();
    await waitFor(() => {
      expect(textarea).toHaveValue('second');
    });
    expect(textarea).toHaveFocus();
  });

  it('clears unchanged draft after slow send completes', async () => {
    let resolveSend: (() => void) | undefined;
    const onSendChunk = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'slow send');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    resolveSend?.();
    await waitFor(() => {
      expect(textarea).toHaveValue('');
    });
    expect(textarea).toHaveFocus();
  });

  it('preserves input and shows error when send fails', async () => {
    const onSendChunk = vi.fn().mockRejectedValue(new Error('timeout'));
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'stuck text');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('timeout');
    });
    expect(textarea).toHaveValue('stuck text');
  });

  it('restores draft when viewKey changes', () => {
    localStorage.setItem(
      draftsStorageKey('meshcore'),
      JSON.stringify({ 'room:42': 'saved draft' }),
    );
    const { rerender } = render(
      <ChatComposer
        protocol="meshcore"
        viewKey="room:42"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('saved draft');
    rerender(
      <ChatComposer
        protocol="meshcore"
        viewKey="room:99"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('shows emoji-picker on Linux when emoji button is clicked', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Emoji' }));
    expect(document.querySelector('emoji-picker')).toBeInTheDocument();
  });

  it('inserts emoji from Linux picker into textarea', async () => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue('linux');
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Emoji' }));
    const picker = document.querySelector('emoji-picker');
    expect(picker).toBeInTheDocument();
    fireEvent(
      picker!,
      new CustomEvent('emoji-click', {
        detail: { emoji: { unicode: '😀' } },
        bubbles: true,
      }),
    );
    expect(screen.getByRole('textbox')).toHaveValue('😀');
  });

  it('hides character counter below 80% threshold', () => {
    render(
      <ChatComposer
        protocol="meshtastic"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(100) } });
    expect(screen.queryByText(/\//)).not.toBeInTheDocument();
  });

  it('shows approaching counter at 80%+ for meshtastic', () => {
    render(
      <ChatComposer
        protocol="meshtastic"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(183) } });
    expect(screen.getByText(`183 / ${MESHTASTIC_PAYLOAD_LIMIT}`)).toBeInTheDocument();
  });

  it('shows split counter and send parts label when message exceeds limit', () => {
    render(
      <ChatComposer
        protocol="meshtastic"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'a'.repeat(250) } });
    expect(screen.getAllByText('250 characters · 2 messages').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Send 2 parts' })).toBeInTheDocument();
  });

  it('hides GIF button when MeshCore Open wire compat is disabled', () => {
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Insert Giphy GIF' })).toBeNull();
  });

  it('sends g: wire from GIF modal when Open wire compat is enabled', async () => {
    localStorage.setItem(
      'mesh-client:appSettings',
      JSON.stringify({ meshcoreOpenWireCompatEnabled: true }),
    );
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Insert Giphy GIF' }));
    const gifField = screen.getByRole('textbox', { name: 'Giphy URL or id' });
    fireEvent.change(gifField, { target: { value: 'g:a5viI92PAF89q' } });
    await user.click(screen.getByRole('button', { name: 'Send GIF' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith('g:a5viI92PAF89q');
    });
  });
});
