// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  installKeyboardOwnerGuard,
  KEYBOARD_OWNER_ATTRIBUTE,
} from '@/renderer/lib/keyboardOwnerLayer';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';

import MeshcoreChatChannelManager from '../MeshcoreChatChannelManager';
import { ToastProvider } from '../Toast';
import { ReticulumVoiceOverlay } from './ReticulumVoiceOverlay';

const answer = vi.fn();
const reject = vi.fn();
const hangup = vi.fn();
const setMuted = vi.fn();
const startMedia = vi.fn();
const syncTones = vi.fn();

vi.mock('@/renderer/lib/reticulumVoiceSession', () => ({
  reticulumVoiceAnswer: () => answer(),
  reticulumVoiceReject: () => reject(),
  reticulumVoiceHangup: () => hangup(),
  reticulumVoiceSetMuted: (...args: unknown[]) => setMuted(...args),
  startReticulumVoiceMediaForActiveCall: (...args: unknown[]) => startMedia(...args),
  stopReticulumVoiceMedia: vi.fn(),
  syncReticulumVoiceProgressTones: (...args: unknown[]) => syncTones(...args),
}));

describe('ReticulumVoiceOverlay', () => {
  beforeEach(() => {
    answer.mockReset();
    reject.mockReset();
    hangup.mockReset();
    setMuted.mockReset();
    startMedia.mockReset();
    syncTones.mockReset();
    act(() => {
      useReticulumVoiceStore.getState().clearCall();
      useReticulumPeerStore.getState().clearPeers();
    });
  });

  it('shows incoming dialog and fires answer/reject', async () => {
    const user = userEvent.setup();
    act(() => {
      useReticulumVoiceStore.getState().applyIncoming({
        link_id: 'a'.repeat(32),
        remote_identity: 'b'.repeat(32),
        role: 'incoming',
        status: 'ringing',
      });
    });
    const { container } = render(<ReticulumVoiceOverlay />);
    expect(screen.getByRole('dialog', { name: /incoming voice call/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /answer voice call/i }));
    expect(answer).toHaveBeenCalled();
    act(() => {
      useReticulumVoiceStore.getState().applyIncoming({
        link_id: 'a'.repeat(32),
        remote_identity: 'b'.repeat(32),
        role: 'incoming',
        status: 'ringing',
      });
    });
    render(<ReticulumVoiceOverlay />);
    await user.click(screen.getAllByRole('button', { name: /reject voice call/i })[0]);
    expect(reject).toHaveBeenCalled();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  describe('ringing over the rest of the app', () => {
    const ring = () => {
      act(() => {
        useReticulumVoiceStore.getState().applyIncoming({
          link_id: 'a'.repeat(32),
          remote_identity: 'b'.repeat(32),
          role: 'incoming',
          status: 'ringing',
        });
      });
    };

    it('takes focus on its panel, not Answer, and gives it back when the ring ends', () => {
      const uninstall = installKeyboardOwnerGuard(window);
      try {
        render(
          <>
            <input aria-label="Message" />
            <ReticulumVoiceOverlay />
          </>,
        );
        const composer = screen.getByRole('textbox', { name: 'Message' });
        composer.focus();

        ring();
        const dialog = screen.getByRole('dialog', { name: /incoming voice call/i });
        expect(dialog.hasAttribute(KEYBOARD_OWNER_ATTRIBUTE)).toBe(true);
        expect(dialog.contains(document.activeElement)).toBe(true);
        expect(document.activeElement).not.toBe(
          screen.getByRole('button', { name: /answer voice call/i }),
        );

        act(() => {
          useReticulumVoiceStore.getState().clearCall();
        });
        expect(document.activeElement).toBe(composer);
      } finally {
        uninstall();
      }
    });

    it('keeps Tab and Escape on the call while the Add Channel dialog is open under it', async () => {
      const uninstall = installKeyboardOwnerGuard(window);
      try {
        const user = userEvent.setup();
        const onSetChannel = vi.fn().mockResolvedValue(undefined);
        render(
          <ToastProvider>
            <MeshcoreChatChannelManager
              channels={[{ index: 0, name: '#general', secret: new Uint8Array(16).fill(1) }]}
              disabled={false}
              onSetChannel={onSetChannel}
              onSelectChannel={vi.fn()}
            />
            <ReticulumVoiceOverlay />
          </ToastProvider>,
        );
        await user.click(screen.getByRole('button', { name: '+ Add Channel' }));
        const name = screen.getByLabelText('Name');
        await user.type(name, 'storm');

        ring();
        const call = screen.getByRole('dialog', { name: /incoming voice call/i });
        // The dialog under the call grabbing focus back (as ConfirmModal does when its parent
        // re-renders) must not leave Enter pointed at it.
        act(() => {
          name.focus();
        });
        expect(call.contains(document.activeElement)).toBe(true);
        await user.keyboard('{Enter}');
        expect(onSetChannel).not.toHaveBeenCalled();

        await user.keyboard('{Tab}');
        expect(document.activeElement).toBe(
          screen.getByRole('button', { name: /answer voice call/i }),
        );
        await user.keyboard('{Tab}');
        expect(document.activeElement).toBe(
          screen.getByRole('button', { name: /reject voice call/i }),
        );
        await user.keyboard('{Tab}');
        expect(call.contains(document.activeElement)).toBe(true);
        await user.keyboard('{Escape}');
        expect(screen.getByRole('dialog', { name: 'Add Channel' })).toBeTruthy();
        expect(screen.getByRole('dialog', { name: /incoming voice call/i })).toBe(call);

        act(() => {
          useReticulumVoiceStore.getState().clearCall();
        });
        expect(document.activeElement).toBe(name);
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('dialog', { name: 'Add Channel' })).toBeNull();
      } finally {
        uninstall();
      }
    });
  });

  it('in-call bar mute and hangup fire helpers with no axe violations', async () => {
    const user = userEvent.setup();
    act(() => {
      useReticulumVoiceStore.getState().applyUpdate({
        type: 'snapshot',
        active_call: {
          link_id: 'a'.repeat(32),
          remote_identity: 'b'.repeat(32),
          role: 'outgoing',
          status: 'established',
        },
      });
    });
    const { container } = render(<ReticulumVoiceOverlay />);
    expect(screen.getByRole('status', { name: /in call/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /mute microphone/i }));
    expect(setMuted).toHaveBeenCalledWith(true);
    await user.click(screen.getByRole('button', { name: /hang up voice call/i }));
    expect(hangup).toHaveBeenCalled();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('closes incoming dialog after answer progresses to connecting/established', async () => {
    const user = userEvent.setup();
    act(() => {
      useReticulumVoiceStore.getState().applyIncoming({
        link_id: 'a'.repeat(32),
        remote_identity: 'b'.repeat(32),
        role: 'incoming',
        status: 'ringing',
      });
    });
    render(<ReticulumVoiceOverlay />);
    expect(screen.getByRole('dialog', { name: /incoming voice call/i })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /answer voice call/i }));
    expect(answer).toHaveBeenCalled();
    act(() => {
      useReticulumVoiceStore.getState().applyUpdate({
        type: 'snapshot',
        active_call: {
          link_id: 'a'.repeat(32),
          remote_identity: 'b'.repeat(32),
          role: 'incoming',
          status: 'connecting',
          answered: true,
        },
      });
    });
    expect(screen.queryByRole('dialog', { name: /incoming voice call/i })).toBeNull();
    expect(screen.getByRole('status', { name: /ringing/i })).toBeTruthy();
    expect(startMedia).not.toHaveBeenCalled();

    act(() => {
      useReticulumVoiceStore.getState().applyUpdate({
        type: 'snapshot',
        active_call: {
          link_id: 'a'.repeat(32),
          remote_identity: 'b'.repeat(32),
          role: 'incoming',
          status: 'established',
          answered: true,
        },
      });
    });
    expect(screen.queryByRole('dialog', { name: /incoming voice call/i })).toBeNull();
    expect(screen.getByRole('status', { name: /in call/i })).toBeTruthy();
    expect(startMedia).toHaveBeenCalledTimes(1);
  });

  it('inbound connecting does not start media; inbound established starts once', () => {
    act(() => {
      useReticulumVoiceStore.getState().applyUpdate({
        type: 'snapshot',
        active_call: {
          link_id: 'a'.repeat(32),
          remote_identity: 'b'.repeat(32),
          role: 'incoming',
          status: 'connecting',
          answered: true,
        },
      });
    });
    render(<ReticulumVoiceOverlay />);
    expect(screen.getByRole('status', { name: /ringing/i })).toBeTruthy();
    expect(startMedia).not.toHaveBeenCalled();

    act(() => {
      useReticulumVoiceStore.getState().applyUpdate({
        type: 'snapshot',
        active_call: {
          link_id: 'a'.repeat(32),
          remote_identity: 'b'.repeat(32),
          role: 'incoming',
          status: 'established',
          answered: true,
        },
      });
    });
    expect(screen.getByRole('status', { name: /in call/i })).toBeTruthy();
    expect(startMedia).toHaveBeenCalledTimes(1);
  });

  it('shows Connecting on calling and does not start media until established', () => {
    act(() => {
      useReticulumVoiceStore.getState().beginOutgoing('b'.repeat(32));
    });
    render(<ReticulumVoiceOverlay />);
    expect(screen.getByRole('status', { name: /connecting/i })).toBeTruthy();
    expect(startMedia).not.toHaveBeenCalled();
    expect(syncTones).toHaveBeenCalledWith('calling');

    act(() => {
      useReticulumVoiceStore.getState().applyUpdate({
        type: 'outgoing',
        link_id: 'a'.repeat(32),
        remote_identity: 'b'.repeat(32),
      });
    });
    expect(screen.getByRole('status', { name: /ringing/i })).toBeTruthy();
    expect(startMedia).not.toHaveBeenCalled();
  });

  it('shows hangup while optimistic calling with TX/RX counters', async () => {
    const user = userEvent.setup();
    const dest = 'c'.repeat(32);
    const id = 'b'.repeat(32);
    act(() => {
      useReticulumPeerStore.setState({
        peers: new Map([
          [
            dest,
            {
              destination_hash: dest,
              identity_hash: id,
              display_name: 'Dial Peer',
              hops: 1,
            },
          ],
        ]),
        peersRevision: 1,
      });
      useReticulumVoiceStore.getState().beginOutgoing(id);
      useReticulumVoiceStore.getState().applyStats({
        tx_frames: 4,
        tx_packets: 3,
        rx_frames: 1,
      });
    });
    const { container } = render(<ReticulumVoiceOverlay />);
    expect(screen.getByRole('status', { name: /connecting/i })).toBeTruthy();
    const panel = screen.getByRole('status', { name: /connecting/i });
    expect(panel.className).toContain('top-1/2');
    expect(panel.className).toContain('left-1/2');
    expect(panel.className).toContain('-translate-x-1/2');
    expect(panel.className).toContain('-translate-y-1/2');
    expect(panel.className).not.toContain('bottom-3');
    expect(screen.getByText('Dial Peer')).toBeTruthy();
    expect(screen.queryByText(id)).toBeNull();
    expect(screen.getByText(/TX 4/i)).toBeTruthy();
    expect(screen.getByText(/RX 1/i)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /hang up voice call/i }));
    expect(hangup).toHaveBeenCalled();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows peer display name on incoming dialog instead of raw hash', () => {
    const dest = 'd'.repeat(32);
    const id = 'e'.repeat(32);
    act(() => {
      useReticulumPeerStore.setState({
        peers: new Map([
          [
            dest,
            {
              destination_hash: dest,
              identity_hash: id,
              display_name: 'Incoming Peer',
              hops: 0,
            },
          ],
        ]),
        peersRevision: 1,
      });
      useReticulumVoiceStore.getState().applyIncoming({
        link_id: 'a'.repeat(32),
        remote_identity: id,
        role: 'incoming',
        status: 'ringing',
      });
    });
    render(<ReticulumVoiceOverlay />);
    expect(screen.getByText('Incoming Peer')).toBeTruthy();
    expect(screen.queryByText(id)).toBeNull();
  });
});
