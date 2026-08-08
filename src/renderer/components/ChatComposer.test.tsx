import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { MESHTASTIC_PAYLOAD_LIMIT } from '@/renderer/lib/chatComposerLimits';
import {
  draftsStorageKey,
  FLOOD_SCOPE_OVERRIDE_UNSCOPED,
  floodScopeOverridesStorageKey,
  loadFloodScopeOverridesInitial,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { resetMeshcoreSendRateForTests } from '@/renderer/lib/meshcoreSendRateNotice';
import { resetMeshtasticTextSendPacingForTests } from '@/renderer/lib/meshtasticTextSendPacing';
import { MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS } from '@/renderer/lib/timeConstants';

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
        'chatPanel.composeLimit.limitHintSingle': `Up to ${opts?.limit} characters. Single packet.`,
        'chatPanel.composeLimit.splitHint': 'Sent as separate packets labeled [1/N], [2/N], …',
        'chatPanel.composeLimit.meshcoreSingleNotice.title': 'Message too long for MeshCore',
        'chatPanel.composeLimit.meshcoreSingleNotice.hint':
          'MeshCore sends one packet per message; longer messages can’t be sent.',
        'chatPanel.meshcoreFastSend.warning':
          'You’re sending faster than the mesh can relay. Leave a few seconds between messages.',
        'common.dismiss': 'Dismiss',
        'chatPanel.meshcoreGifButton': 'Insert Giphy GIF',
        'chatPanel.meshcoreGifPlaceholder': 'Giphy URL or id',
        'chatPanel.meshcoreGifSend': 'Send GIF',
        'chatPanel.shareLocation': 'Share location',
        'chatPanel.shareLocationLabel': 'Location',
        'chatPanel.floodScopeOverrideDefault': 'Default scope',
        'chatPanel.floodScopeOverrideUnscoped': 'Unscoped',
        'chatPanel.floodScopeOverrideAria': 'Per-channel flood scope override',
        'chatPanel.floodScopeOverrideMenuButton': 'Change flood scope for this channel',
        'chatPanel.floodScopeOverrideHint': 'Remembered per channel.',
        'chatPanel.floodScopeOverrideCustom': 'Custom scope…',
        'chatPanel.floodScopeOverrideCustomLabel': 'Custom flood scope hashtag',
        'chatPanel.floodScopeOverrideCustomPlaceholder': '#metro',
        'chatPanel.floodScopeOverrideCustomApply': 'Use scope',
        'chatPanel.floodScopeOverrideCustomInvalid': 'Enter a valid region hashtag',
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
      if (key === 'chatPanel.composeLimit.overMaxSingle') {
        return `Too long — MeshCore sends one packet per message (max ${opts?.limit} characters)`;
      }
      if (key === 'chatPanel.composeLimit.meshcoreSingleNotice.body') {
        return `MeshCore sends each message as a single radio packet (up to ${opts?.limit} characters). Longer messages are dropped in parts, so mesh-client doesn't split them.`;
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
    resetMeshtasticTextSendPacingForTests();
    resetMeshcoreSendRateForTests();
  });

  it('has no axe violations when connected', async () => {
    const { container } = render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations with the meshcore over-limit callout visible', async () => {
    const { container } = render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'a'.repeat(200) } });
    await screen.findByRole('note');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('has no axe violations with the fast-send advisory visible', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
      />,
    );
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    fireEvent.change(textarea, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('status');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
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

  it('paces meshtastic multi-chunk sends to avoid firmware RATE_LIMIT_EXCEEDED', async () => {
    // Regression: firmware rejects a second TEXT_MESSAGE_APP within 2s of the first
    // (Routing_Error.RATE_LIMIT_EXCEEDED). Chunks must not fire back-to-back.
    vi.useFakeTimers();
    try {
      const onSendChunk = vi.fn().mockResolvedValue(undefined);
      render(
        <ChatComposer
          protocol="meshtastic"
          viewKey="ch:0"
          isConnected
          allowOutbox={false}
          onSendChunk={onSendChunk}
        />,
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'a'.repeat(250) } });
      fireEvent.click(screen.getByRole('button', { name: 'Send 2 parts' }));

      await vi.advanceTimersByTimeAsync(0);
      expect(onSendChunk).toHaveBeenCalledTimes(1);
      expect(onSendChunk).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('[1/2]'),
        expect.objectContaining({ chunkIndex: 0 }),
      );

      await vi.advanceTimersByTimeAsync(MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS - 100);
      expect(onSendChunk).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(200);
      expect(onSendChunk).toHaveBeenCalledTimes(2);
      expect(onSendChunk).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('[2/2]'),
        expect.objectContaining({ chunkIndex: 1 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not delay single-chunk meshtastic sends', async () => {
    vi.useFakeTimers();
    try {
      const onSendChunk = vi.fn().mockResolvedValue(undefined);
      render(
        <ChatComposer
          protocol="meshtastic"
          viewKey="ch:0"
          isConnected
          allowOutbox={false}
          onSendChunk={onSendChunk}
        />,
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'hello' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));

      await vi.advanceTimersByTimeAsync(0);
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends a single-chunk meshcore message once', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
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
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    expect(onSendChunk).toHaveBeenCalledWith('hello', expect.objectContaining({ chunkIndex: 0 }));
    // No single-packet callout for an in-limit message.
    expect(screen.queryByText('Message too long for MeshCore')).toBeNull();
  });

  it('rightfully fails to send an over-length meshcore message (no split, blocked)', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
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
    // MeshCore channel payload limit is ~130-158 bytes; 200 chars is over one packet.
    const longText = 'a'.repeat(200);
    fireEvent.change(textarea, { target: { value: longText } });

    // The single-packet callout explains why longer text is blocked.
    const note = await screen.findByRole('note');
    expect(note).toHaveTextContent('Message too long for MeshCore');

    // Send is disabled...
    const sendButton = screen.getByRole('button', { name: 'Send' });
    expect(sendButton).toBeDisabled();

    // ...and attempting to send via Enter is a no-op (handleSend guard), never split.
    fireEvent.keyDown(textarea, { key: 'Enter' });
    await Promise.resolve();
    expect(onSendChunk).not.toHaveBeenCalled();

    // Draft is retained so the user can shorten and resend.
    expect((textarea as HTMLTextAreaElement).value).toBe(longText);
  });

  it('exposes a warn-phase hint about single-packet sends', () => {
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    const textarea = screen.getByRole('textbox');
    // ~85% of a ~157-char channel limit → warn phase (not over), surfacing the ⓘ hint.
    fireEvent.change(textarea, { target: { value: 'a'.repeat(140) } });
    expect(
      screen.getByLabelText(
        'MeshCore sends one packet per message; longer messages can’t be sent.',
      ),
    ).toBeInTheDocument();
  });

  it('shows a non-blocking fast-send warning when two meshcore sends happen within 5s', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
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

    fireEvent.change(textarea, { target: { value: 'first' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    // First send: not too fast, no warning.
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.change(textarea, { target: { value: 'second' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(2);
    });
    // Second send within 5s: both sends went through (never blocked) and the advisory shows.
    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('sending faster than the mesh');
  });

  it('does not show the fast-send warning for meshtastic (meshcore-only advisory)', async () => {
    vi.useFakeTimers();
    try {
      const onSendChunk = vi.fn().mockResolvedValue(undefined);
      render(
        <ChatComposer
          protocol="meshtastic"
          viewKey="ch:0"
          isConnected
          allowOutbox={false}
          onSendChunk={onSendChunk}
        />,
      );
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, { target: { value: 'first' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await vi.advanceTimersByTimeAsync(0);
      fireEvent.change(textarea, { target: { value: 'second' } });
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      // Meshtastic send pacing delays the second send by the pacing interval; advance past it.
      await vi.advanceTimersByTimeAsync(MESHTASTIC_TEXT_CHUNK_SEND_INTERVAL_MS + 100);
      expect(onSendChunk).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole('status')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('carries the fast-send advisory from a GIF send to a following text send', async () => {
    // A GIF is a live MeshCore packet, so a text send within 5s of it should still warn.
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
    // First send of the session — no advisory yet.
    expect(screen.queryByRole('status')).toBeNull();

    const textarea = screen.getByRole('textbox', { name: 'Type a message…' });
    await user.type(textarea, 'quick follow-up');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith(
        'quick follow-up',
        expect.objectContaining({ chunkIndex: 0 }),
      );
    });
    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('sending faster than the mesh');
  });

  it('shows the fast-send advisory on rapid GIF-to-GIF sends', async () => {
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
    fireEvent.change(screen.getByRole('textbox', { name: 'Giphy URL or id' }), {
      target: { value: 'g:a5viI92PAF89q' },
    });
    await user.click(screen.getByRole('button', { name: 'Send GIF' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('status')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Insert Giphy GIF' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Giphy URL or id' }), {
      target: { value: 'g:b6wjJ03QBG90r' },
    });
    await user.click(screen.getByRole('button', { name: 'Send GIF' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(2);
    });
    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('sending faster than the mesh');
  });

  it('carries the fast-send advisory from a shared location to a following text send', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const resolveShareLocation = vi.fn().mockResolvedValue({ lat: 39.7392, lon: -104.9903 });
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
        resolveShareLocation={resolveShareLocation}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Share location' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('status')).toBeNull();

    const textarea = screen.getByRole('textbox', { name: 'Type a message…' });
    await user.type(textarea, 'on my way');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(2);
    });
    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('sending faster than the mesh');
  });

  it('shows the fast-send advisory on rapid location-to-location sends', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const resolveShareLocation = vi.fn().mockResolvedValue({ lat: 39.7392, lon: -104.9903 });
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={onSendChunk}
        resolveShareLocation={resolveShareLocation}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Share location' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByRole('status')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Share location' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledTimes(2);
    });
    const warning = await screen.findByRole('status');
    expect(warning).toHaveTextContent('sending faster than the mesh');
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

  it('hides flood-scope menu button when showFloodScopeOverride is false', () => {
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        onSendChunk={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Change flood scope for this channel' }),
    ).toBeNull();
  });

  it('shows flood-scope menu button when showFloodScopeOverride is true', () => {
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        onSendChunk={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Change flood scope for this channel' }),
    ).toBeInTheDocument();
  });

  it('sends with saved floodScopeOverride after selecting from menu', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const onRememberFloodScopePreset = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#eu', '#jp']}
        onRememberFloodScopePreset={onRememberFloodScopePreset}
        onSendChunk={onSendChunk}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Change flood scope for this channel' }));
    // fireEvent: portaled menu is off-screen in jsdom (zero button rect).
    fireEvent.click(screen.getByRole('button', { name: '#eu' }));
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: #eu',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText('#eu')).toBeInTheDocument();

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'scoped hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith('scoped hello', {
        replyId: undefined,
        chunkIndex: 0,
        floodScopeOverride: '#eu',
      });
    });
    expect(onRememberFloodScopePreset).toHaveBeenCalledWith('#eu');
  });

  it('sends empty floodScopeOverride for Unscoped selection', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const onRememberFloodScopePreset = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#eu']}
        onRememberFloodScopePreset={onRememberFloodScopePreset}
        onSendChunk={onSendChunk}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Change flood scope for this channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unscoped' }));
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: Unscoped',
      }),
    ).toBeInTheDocument();

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'unscoped hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith('unscoped hello', {
        replyId: undefined,
        chunkIndex: 0,
        floodScopeOverride: '',
      });
    });
    expect(onRememberFloodScopePreset).not.toHaveBeenCalled();
  });

  it('omits floodScopeOverride when Default scope is selected', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#jp']}
        onSendChunk={onSendChunk}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Change flood scope for this channel' }));
    fireEvent.click(screen.getByRole('button', { name: '#jp' }));
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: #jp',
      }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: #jp',
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Default scope' }));
    expect(
      screen.getByRole('button', { name: 'Change flood scope for this channel' }),
    ).toBeInTheDocument();

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'default hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith(
        'default hello',
        expect.objectContaining({
          replyId: undefined,
          chunkIndex: 0,
          floodScopeOverride: undefined,
        }),
      );
    });
  });

  it('remembers Unscoped on Public and #metro on metrolink across view switches', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#metro']}
        onSendChunk={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Change flood scope for this channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Unscoped' }));
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: Unscoped',
      }),
    ).toBeInTheDocument();
    expect(loadFloodScopeOverridesInitial('meshcore')['ch:0']).toBe(FLOOD_SCOPE_OVERRIDE_UNSCOPED);

    rerender(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:1"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#metro']}
        onSendChunk={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Change flood scope for this channel' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change flood scope for this channel' }));
    fireEvent.click(screen.getByRole('button', { name: '#metro' }));
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: #metro',
      }),
    ).toBeInTheDocument();
    expect(loadFloodScopeOverridesInitial('meshcore')).toEqual({
      'ch:0': FLOOD_SCOPE_OVERRIDE_UNSCOPED,
      'ch:1': '#metro',
    });

    rerender(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#metro']}
        onSendChunk={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: Unscoped',
      }),
    ).toBeInTheDocument();

    rerender(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:1"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#metro']}
        onSendChunk={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: #metro',
      }),
    ).toBeInTheDocument();
  });

  it('restores per-channel flood scope from localStorage on mount', () => {
    localStorage.setItem(
      floodScopeOverridesStorageKey('meshcore'),
      JSON.stringify({
        'ch:0': FLOOD_SCOPE_OVERRIDE_UNSCOPED,
        'ch:1': '#metro',
      }),
    );
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:1"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={['#metro']}
        onSendChunk={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: #metro',
      }),
    ).toBeInTheDocument();
  });

  it('applies a custom scope from the menu and remembers it after successful send', async () => {
    const onSendChunk = vi.fn().mockResolvedValue(undefined);
    const onRememberFloodScopePreset = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={[]}
        onRememberFloodScopePreset={onRememberFloodScopePreset}
        onSendChunk={onSendChunk}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Change flood scope for this channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom scope…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom flood scope hashtag' }), {
      target: { value: 'berlin' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use scope' }));
    expect(
      screen.getByRole('button', {
        name: 'Change flood scope for this channel: #berlin',
      }),
    ).toBeInTheDocument();

    const textarea = screen.getByRole('textbox', { name: 'Type a message…' });
    await user.type(textarea, 'custom hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(onSendChunk).toHaveBeenCalledWith('custom hello', {
        replyId: undefined,
        chunkIndex: 0,
        floodScopeOverride: '#berlin',
      });
    });
    expect(onRememberFloodScopePreset).toHaveBeenCalledWith('#berlin');
  });

  it('does not remember a custom scope when send fails', async () => {
    const onSendChunk = vi.fn().mockRejectedValue(new Error('timeout'));
    const onRememberFloodScopePreset = vi.fn();
    const user = userEvent.setup();
    render(
      <ChatComposer
        protocol="meshcore"
        viewKey="ch:0"
        isConnected
        allowOutbox={false}
        showFloodScopeOverride
        floodScopePresets={[]}
        onRememberFloodScopePreset={onRememberFloodScopePreset}
        onSendChunk={onSendChunk}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Change flood scope for this channel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Custom scope…' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Custom flood scope hashtag' }), {
      target: { value: '#fail' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use scope' }));

    const textarea = screen.getByRole('textbox', { name: 'Type a message…' });
    await user.type(textarea, 'will fail');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('timeout');
    });
    expect(onRememberFloodScopePreset).not.toHaveBeenCalled();
  });
});
