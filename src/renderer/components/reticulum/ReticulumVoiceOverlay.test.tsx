// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';

import { ReticulumVoiceOverlay } from './ReticulumVoiceOverlay';

const answer = vi.fn();
const reject = vi.fn();
const hangup = vi.fn();
const setMuted = vi.fn();

vi.mock('@/renderer/lib/reticulumVoiceSession', () => ({
  reticulumVoiceAnswer: () => answer(),
  reticulumVoiceReject: () => reject(),
  reticulumVoiceHangup: () => hangup(),
  reticulumVoiceSetMuted: (...args: unknown[]) => setMuted(...args),
  startReticulumVoiceMediaForActiveCall: vi.fn(),
  stopReticulumVoiceMedia: vi.fn(),
  syncReticulumVoiceProgressTones: vi.fn(),
}));

describe('ReticulumVoiceOverlay', () => {
  beforeEach(() => {
    answer.mockReset();
    reject.mockReset();
    hangup.mockReset();
    setMuted.mockReset();
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
    expect(screen.getByRole('status', { name: /connecting|in call/i })).toBeTruthy();

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
    expect(screen.getByRole('status', { name: /calling/i })).toBeTruthy();
    const panel = screen.getByRole('status', { name: /calling/i });
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
