// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import i18n from '@/renderer/lib/i18n';
import { LXST_TELEPHONY_ASPECT } from '@/renderer/lib/reticulumVoiceCapability';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumVoiceStore } from '@/renderer/stores/reticulumVoiceStore';

import { buttonClassName } from '../ui/Button';
import { ReticulumVoiceCallButton } from './ReticulumVoiceCallButton';

const callPeer = vi.fn();
const peerHash = 'a'.repeat(32);
const identityHash = 'b'.repeat(32);

vi.mock('@/renderer/lib/reticulumVoiceSession', () => ({
  reticulumVoiceCallPeer: (...args: unknown[]) => callPeer(...args),
}));

describe('ReticulumVoiceCallButton', () => {
  beforeEach(() => {
    callPeer.mockReset();
    useReticulumVoiceStore.getState().clearCall();
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
  });

  it('invokes call helper with peer hash and has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ReticulumVoiceCallButton lxmfPeerHash={peerHash} identityHash={identityHash} />,
    );
    await user.click(screen.getByRole('button', { name: /start lxst voice call/i }));
    expect(callPeer).toHaveBeenCalledWith(peerHash, { identityHash });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses outlined cyan chip action class and keeps interop only in title', () => {
    render(<ReticulumVoiceCallButton lxmfPeerHash={peerHash} identityHash={identityHash} />);
    const btn = screen.getByRole('button', { name: /start lxst voice call/i });
    expect(btn.className).toContain('border-cyan-500/35');
    expect(btn.className).toMatch(/text-cyan-/);
    expect(btn.className).not.toContain('hover:underline');
    const interop = i18n.t('reticulumVoice.help.interop');
    expect(btn.getAttribute('aria-label')).not.toContain(interop);
    expect(btn.getAttribute('title')).toContain(interop);
    expect(screen.queryByText(interop)).not.toBeInTheDocument();
  });

  it('hides the LXST face pill when capability is unknown', () => {
    render(<ReticulumVoiceCallButton lxmfPeerHash={peerHash} identityHash={identityHash} />);
    expect(
      screen.queryByText(i18n.t('reticulumVoice.capabilityHeardShort')),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(i18n.t('reticulumVoice.capabilityUnknownShort')),
    ).not.toBeInTheDocument();
  });

  it('shows an LXST pill when telephony aspect was heard', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          peerHash,
          [
            {
              destination_hash: peerHash,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: identityHash,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    render(<ReticulumVoiceCallButton lxmfPeerHash={peerHash} identityHash={identityHash} />);
    expect(screen.getByText(i18n.t('reticulumVoice.capabilityHeardShort'))).toBeInTheDocument();
  });

  it('supports Peers secondary styling with cyan icon and axe-clean LXST pill', async () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          peerHash,
          [
            {
              destination_hash: peerHash,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: identityHash,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    const { container } = render(
      <ReticulumVoiceCallButton
        lxmfPeerHash={peerHash}
        identityHash={identityHash}
        className={buttonClassName('secondary', 'sm')}
        iconClassName="text-cyan-400"
      />,
    );
    const btn = screen.getByRole('button', { name: /start lxst voice call/i });
    expect(btn.className).toContain('bg-sidebar-active-bg');
    expect(btn.className).not.toContain('border-cyan-500/35');
    expect(btn.querySelector('svg.text-cyan-400')).toBeTruthy();
    expect(screen.getByText(i18n.t('reticulumVoice.capabilityHeardShort'))).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('disables while a voice session is busy', () => {
    useReticulumVoiceStore.getState().beginOutgoing('c'.repeat(32));
    render(<ReticulumVoiceCallButton lxmfPeerHash={peerHash} identityHash={identityHash} />);
    expect(screen.getByRole('button', { name: /start lxst voice call/i })).toBeDisabled();
  });
});
