import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

import MeshcoreChatChannelManager from './MeshcoreChatChannelManager';
import { ToastProvider } from './Toast';

const configuredSecret = new Uint8Array([1, ...new Array<number>(15).fill(0)]);

function renderManager(
  overrides: Partial<React.ComponentProps<typeof MeshcoreChatChannelManager>> = {},
) {
  const props: React.ComponentProps<typeof MeshcoreChatChannelManager> = {
    channels: [{ index: 0, name: '#general', secret: configuredSecret }],
    disabled: false,
    onSetChannel: vi.fn().mockResolvedValue(undefined),
    onSelectChannel: vi.fn(),
    ...overrides,
  };
  function Manager() {
    const [channels, setChannels] = useState(props.channels);
    return (
      <ToastProvider>
        <MeshcoreChatChannelManager
          {...props}
          channels={channels}
          onSetChannel={async (index, name, secret) => {
            await props.onSetChannel(index, name, secret);
            setChannels((previous) => [
              ...previous.filter((channel) => channel.index !== index),
              { index, name, secret },
            ]);
          }}
        />
      </ToastProvider>
    );
  }
  render(<Manager />);
  return props;
}

describe('MeshcoreChatChannelManager', () => {
  it('adds a hashtag channel to the first free slot and selects it', async () => {
    const user = userEvent.setup();
    const props = renderManager({
      channels: [
        { index: 0, name: '#general', secret: configuredSecret },
        { index: 2, name: '#alerts', secret: configuredSecret },
      ],
    });

    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.type(screen.getByLabelText('Name'), 'weather');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(props.onSetChannel).toHaveBeenCalledTimes(1);
    });
    const [index, name, secret] = vi.mocked(props.onSetChannel).mock.calls[0];
    expect(index).toBe(1);
    expect(name).toBe('#weather');
    expect(
      Array.from(secret)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join(''),
    ).toBe('88f502554fee92a1625cfb311546e7cb');
    expect(props.onSelectChannel).toHaveBeenCalledWith(1);
  });

  it('selects an existing exact channel instead of creating a duplicate', async () => {
    const user = userEvent.setup();
    const props = renderManager();

    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.type(screen.getByLabelText('Name'), 'general');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(props.onSetChannel).not.toHaveBeenCalled();
    expect(props.onSelectChannel).toHaveBeenCalledWith(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('#general is already added.')).toBeVisible();
  });

  it('adds a private channel with its supplied key and unprefixed name', async () => {
    const user = userEvent.setup();
    const props = renderManager();

    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    await user.type(screen.getByLabelText('Name'), ' Team ');
    const key = screen.getByLabelText('Key (32 hex chars = 16 bytes)');
    expect(key).toHaveAttribute('type', 'password');
    await user.type(key, ' 0123456789ABCDEF0123456789ABCDEF ');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(props.onSetChannel).toHaveBeenCalledWith(
        1,
        'Team',
        new Uint8Array([1, 35, 69, 103, 137, 171, 205, 239, 1, 35, 69, 103, 137, 171, 205, 239]),
      );
    });
    expect(props.onSelectChannel).toHaveBeenCalledWith(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['', 'a'.repeat(31), 'a'.repeat(33), 'ag'.repeat(16), '0'.repeat(32)])(
    'rejects an invalid or unset private key (%s)',
    async (keyHex) => {
      const user = userEvent.setup();
      const props = renderManager();
      await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
      await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
      await user.type(screen.getByLabelText('Name'), 'Team');
      if (keyHex) await user.type(screen.getByLabelText('Key (32 hex chars = 16 bytes)'), keyHex);
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      await user.type(screen.getByLabelText('Name'), '{Enter}');
      expect(props.onSetChannel).not.toHaveBeenCalled();
      expect(props.onSelectChannel).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'matches private channels by name and key (same key: %s)',
    async (sameKey) => {
      const user = userEvent.setup();
      const props = renderManager({
        channels: [{ index: 0, name: '#team', secret: new Uint8Array(16).fill(0xaa) }],
      });
      await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
      await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
      await user.type(screen.getByLabelText('Name'), '#team');
      await user.type(
        screen.getByLabelText('Key (32 hex chars = 16 bytes)'),
        (sameKey ? 'aa' : 'bb').repeat(16),
      );
      await user.click(screen.getByRole('button', { name: 'Save' }));

      if (sameKey) {
        expect(props.onSetChannel).not.toHaveBeenCalled();
        expect(props.onSelectChannel).toHaveBeenCalledWith(0);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByText('#team is already added.')).toBeVisible();
      } else {
        await waitFor(() => {
          expect(props.onSetChannel).toHaveBeenCalledWith(
            1,
            '#team',
            new Uint8Array(16).fill(0xbb),
          );
        });
        expect(props.onSelectChannel).toHaveBeenCalledWith(1);
      }
    },
  );

  it('requires a private name and accepts the full 31-character name limit', async () => {
    const user = userEvent.setup();
    const props = renderManager();
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    await user.type(screen.getByLabelText('Key (32 hex chars = 16 bytes)'), 'aa'.repeat(16));
    await user.type(screen.getByLabelText('Name'), ' ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'a'.repeat(32));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), '{Enter}');
    expect(props.onSetChannel).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), ` ${'a'.repeat(31)} `);
    expect(screen.getByLabelText('Name')).toHaveValue(` ${'a'.repeat(31)} `);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(props.onSetChannel).toHaveBeenCalledWith(
        1,
        'a'.repeat(31),
        new Uint8Array(16).fill(0xaa),
      );
    });
  });

  it('returns to hashtag key derivation when private mode is turned off', async () => {
    const user = userEvent.setup();
    const props = renderManager();
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    const mode = screen.getByRole('checkbox', { name: 'Private channel (enter key)' });
    await user.click(mode);
    await user.type(screen.getByLabelText('Name'), 'weather');
    await user.type(screen.getByLabelText('Key (32 hex chars = 16 bytes)'), 'aa'.repeat(16));
    await user.click(mode);
    expect(screen.queryByLabelText('Key (32 hex chars = 16 bytes)')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(props.onSetChannel).toHaveBeenCalledWith(1, '#weather', expect.any(Uint8Array));
    });
    expect(vi.mocked(props.onSetChannel).mock.calls[0][2]).not.toEqual(
      new Uint8Array(16).fill(0xaa),
    );
  });

  it('does not overwrite a channel when all slots are occupied', async () => {
    const user = userEvent.setup();
    const props = renderManager({
      channels: Array.from({ length: 40 }, (_, index) => ({
        index,
        name: `#channel-${index}`,
        secret: configuredSecret,
      })),
    });
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    await user.type(screen.getByLabelText('Name'), 'Team');
    await user.type(screen.getByLabelText('Key (32 hex chars = 16 bytes)'), 'aa'.repeat(16));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(props.onSetChannel).not.toHaveBeenCalled();
    expect(props.onSelectChannel).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('All channel slots are full.');
    expect(screen.getByLabelText('Name')).toHaveValue('Team');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clears the private key when the dialog is dismissed', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    await user.type(screen.getByLabelText('Key (32 hex chars = 16 bytes)'), 'aa'.repeat(16));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    expect(screen.getByLabelText('Key (32 hex chars = 16 bytes)')).toHaveValue('');
  });

  it('keeps the private channel available for retry after a failed save', async () => {
    const warn = mockConsoleWarn();
    const user = userEvent.setup();
    const props = renderManager({
      onSetChannel: vi
        .fn()
        .mockRejectedValueOnce(new Error('Radio disconnected'))
        .mockResolvedValue(undefined),
    });
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    await user.type(screen.getByLabelText('Name'), 'Team');
    await user.type(screen.getByLabelText('Key (32 hex chars = 16 bytes)'), 'aa'.repeat(16));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed: Radio disconnected');
    expect(props.onSelectChannel).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Key (32 hex chars = 16 bytes)')).toHaveValue('aa'.repeat(16));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(props.onSelectChannel).toHaveBeenCalledWith(1);
    });
    warn.restore();
  });

  it('does not open while device channel management is disabled', async () => {
    const user = userEvent.setup();
    renderManager({ disabled: true });
    const add = screen.getByRole('button', { name: '+ Add Channel' });
    expect(add).toBeDisabled();
    await user.click(add);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape without changing the underlying chat view', async () => {
    const user = userEvent.setup();
    const underlyingKeyHandler = vi.fn();
    renderManager();

    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    document.addEventListener('keydown', underlyingKeyHandler);
    await user.keyboard('{Escape}');
    document.removeEventListener('keydown', underlyingKeyHandler);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(underlyingKeyHandler).not.toHaveBeenCalled();
  });

  it('keeps repeat entry opt-in and resets it after closing', async () => {
    const user = userEvent.setup();
    renderManager();
    const add = screen.getByRole('button', { name: '+ Add Channel' });
    await user.click(add);
    expect(screen.getByRole('switch', { name: 'Keep open after adding' })).not.toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Keep open after adding' }));
    await user.type(screen.getByLabelText('Name'), 'weather{Enter}');
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveValue('');
    });
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByRole('dialog')).toHaveTextContent('#weather added.');
    await user.keyboard('{Escape}');
    expect(add).toHaveFocus();
    await user.click(add);
    expect(screen.getByRole('switch', { name: 'Keep open after adding' })).not.toBeChecked();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('#weather added.');
    await user.type(screen.getByLabelText('Name'), 'events{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(add).toHaveFocus();
  });

  it('adds multiple distinct channels without overwriting and handles repeat duplicates', async () => {
    const user = userEvent.setup();
    const props = renderManager();
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('switch', { name: 'Keep open after adding' }));
    for (const name of ['weather', 'events', 'weather']) {
      await user.type(screen.getByLabelText('Name'), `${name}{Enter}`);
      await waitFor(() => {
        expect(screen.getByLabelText('Name')).toHaveValue('');
      });
      expect(screen.getByRole('switch', { name: 'Keep open after adding' })).toBeChecked();
    }
    expect(props.onSetChannel).toHaveBeenCalledTimes(2);
    expect(vi.mocked(props.onSetChannel).mock.calls.map(([index, name]) => [index, name])).toEqual([
      [1, '#weather'],
      [2, '#events'],
    ]);
    expect(screen.getByRole('dialog')).toHaveTextContent('#weather is already added.');
    expect(props.onSelectChannel).toHaveBeenLastCalledWith(1);
    await user.click(screen.getByRole('switch', { name: 'Keep open after adding' }));
    await user.type(screen.getByLabelText('Name'), 'last{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(props.onSetChannel).toHaveBeenLastCalledWith(3, '#last', expect.any(Uint8Array));
  });

  it('retains private mode but clears each saved name and key, including after retry', async () => {
    const warn = mockConsoleWarn();
    const user = userEvent.setup();
    const props = renderManager({
      onSetChannel: vi
        .fn()
        .mockRejectedValueOnce(new Error('Disconnected'))
        .mockResolvedValue(undefined),
    });
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('switch', { name: 'Keep open after adding' }));
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    await user.type(screen.getByLabelText('Name'), 'Team');
    const key = screen.getByLabelText('Key (32 hex chars = 16 bytes)');
    await user.type(key, 'aa'.repeat(16));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Failed: Disconnected');
    expect(screen.getByLabelText('Name')).toHaveValue('Team');
    expect(key).toHaveValue('aa'.repeat(16));
    expect(screen.getByRole('switch', { name: 'Keep open after adding' })).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(key).toHaveValue('');
    });
    expect(screen.getByRole('checkbox', { name: 'Private channel (enter key)' })).toBeChecked();
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.type(screen.getByLabelText('Name'), 'Other');
    await user.type(key, 'bb'.repeat(16));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(key).toHaveValue('');
    });
    expect(props.onSetChannel).toHaveBeenLastCalledWith(2, 'Other', new Uint8Array(16).fill(0xbb));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    expect(screen.getByRole('checkbox', { name: 'Private channel (enter key)' })).not.toBeChecked();
    warn.restore();
  });

  it('locks every action while saving and suppresses synchronous double submissions', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    const props = renderManager({
      onSetChannel: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      ),
    });
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    await user.click(screen.getByRole('switch', { name: 'Keep open after adding' }));
    await user.type(screen.getByLabelText('Name'), 'weather');
    const form = screen.getByLabelText('Name').closest('form')!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => {
      expect(props.onSetChannel).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    expect(screen.getByRole('switch', { name: 'Keep open after adding' })).toBeDisabled();
    await user.keyboard('{Escape}{Tab}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveFocus();
    act(() => {
      finish();
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveValue('');
      expect(screen.getByLabelText('Name')).toHaveFocus();
    });
    expect(props.onSetChannel).toHaveBeenCalledTimes(1);
  });

  it('traps keyboard focus and has accessible public/private repeat entry controls', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    const repeat = screen.getByRole('switch', { name: 'Keep open after adding' });
    repeat.focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(repeat).toHaveFocus();
    await user.keyboard(' ');
    expect(repeat).toBeChecked();
    hydrateAxeThemeColors(screen.getByRole('dialog'));
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
    await user.click(screen.getByRole('checkbox', { name: 'Private channel (enter key)' }));
    hydrateAxeThemeColors(screen.getByRole('dialog'));
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
  });

  it('keeps Shift+Tab inside the dialog when the panel itself has focus', async () => {
    const user = userEvent.setup();
    renderManager();
    await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
    // Clicking the heading or padding focuses the tabIndex=-1 panel.
    screen.getByRole('dialog').focus();
    await user.keyboard('{Shift>}{Tab}{/Shift}');
    expect(screen.getByRole('switch', { name: 'Keep open after adding' })).toHaveFocus();
    screen.getByRole('dialog').focus();
    await user.keyboard('{Tab}');
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus();
  });
});
