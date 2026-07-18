import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import { useReticulumInboundPolicyStore } from '@/renderer/stores/reticulumInboundPolicyStore';
import { useReticulumRemoteAddressStore } from '@/renderer/stores/reticulumRemoteAddressStore';
import { useRncpTransferStore } from '@/renderer/stores/rncpTransferStore';
import { useRnshSessionStore } from '@/renderer/stores/rnshSessionStore';

import ReticulumRemotePanel from './ReticulumRemotePanel';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: vi.fn(() => Promise.resolve(false)),
  isReticulumSidecarExpectedProxyError: vi.fn(() => false),
}));

describe('ReticulumRemotePanel', () => {
  beforeEach(() => {
    useRnshSessionStore.getState().clearAll();
    useRncpTransferStore.getState().clearAll();
    useReticulumRemoteAddressStore.setState({ addresses: new Map(), hydrated: false });
    useReticulumInboundPolicyStore.setState({ policies: new Map(), hydrated: false });
    hydrateAxeThemeColors(document.documentElement);
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(false);
  });

  it('renders the section nav and a sidecar-not-running banner with no axe violations', async () => {
    const { container } = render(<ReticulumRemotePanel isActive />);
    expect(screen.getByRole('button', { name: 'Shell' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Saved' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(
      screen.getByText(/Start the Reticulum stack to use the remote shell/i),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows the empty shell state by default', () => {
    render(<ReticulumRemotePanel isActive />);
    expect(screen.getByText(/No active remote shell sessions/i)).toBeInTheDocument();
  });

  it('switches to the Transfer section and shows the empty transfer list', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<ReticulumRemotePanel isActive />);
    await user.click(screen.getByRole('button', { name: 'Transfer' }));
    expect(screen.getByText('No transfers yet.')).toBeInTheDocument();
  });

  it('switches to the Saved section and shows the empty address list', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<ReticulumRemotePanel isActive />);
    await user.click(screen.getByRole('button', { name: 'Saved' }));
    expect(screen.getByText('No saved addresses yet.')).toBeInTheDocument();
  });

  it('switches to the Settings section and shows the inbound policy toggle', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<ReticulumRemotePanel isActive />);
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByRole('button', { name: 'Off' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ask' })).toBeInTheDocument();
  });

  it('shows a pending-offer badge on the Transfer tab when an offer arrives', () => {
    useRncpTransferStore.getState().applyOffer({
      transfer_id: 't1',
      file_name: 'a.txt',
      bytes: 10,
      identity_hash: 'id1',
    });
    render(<ReticulumRemotePanel isActive />);
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
