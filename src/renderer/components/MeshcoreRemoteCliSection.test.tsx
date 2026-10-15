import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { MeshcoreCompanionRemoteActions } from '../hooks/meshcore/useMeshcoreCompanionRemote';
import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { CliHistoryEntry } from '../lib/repeaterCommandService';
import MeshcoreRemoteCliSection from './MeshcoreRemoteCliSection';

function makeRemote(
  overrides: Partial<MeshcoreCompanionRemoteActions> = {},
): MeshcoreCompanionRemoteActions {
  return {
    getRemoteCliAllowed: vi.fn(() => Promise.resolve(false)),
    setRemoteCliAllowed: vi.fn((_id: number, allowed: boolean) => Promise.resolve(allowed)),
    sendRemoteCli: vi.fn(() => Promise.resolve('> v1.18.0')),
    ...overrides,
  };
}

function openSection(): void {
  const details = document.querySelector('details');
  if (!details) throw new Error('details missing');
  details.open = true;
  fireEvent(details, new Event('toggle'));
}

const HISTORY: CliHistoryEntry[] = [
  { type: 'sent', text: 'ver', timestamp: 1 },
  { type: 'received', text: 'v1.18.0', timestamp: 2 },
];

describe('MeshcoreRemoteCliSection', () => {
  it('reads the permission lazily when opened', async () => {
    const remote = makeRemote();
    render(<MeshcoreRemoteCliSection nodeId={7} remote={remote} history={[]} disabled={false} />);
    expect(remote.getRemoteCliAllowed).not.toHaveBeenCalled();
    openSection();
    const toggle = await screen.findByRole('switch');
    await waitFor(() => {
      expect(toggle).not.toBeDisabled();
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(remote.getRemoteCliAllowed).toHaveBeenCalledWith(7);
  });

  it('asks for confirmation before allowing, and revokes without one', async () => {
    const remote = makeRemote();
    render(<MeshcoreRemoteCliSection nodeId={7} remote={remote} history={[]} disabled={false} />);
    openSection();
    const toggle = await screen.findByRole('switch');
    await waitFor(() => {
      expect(toggle).not.toBeDisabled();
    });
    fireEvent.click(toggle);
    expect(remote.setRemoteCliAllowed).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'true');
    });
    expect(remote.setRemoteCliAllowed).toHaveBeenCalledWith(7, true);

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle).toHaveAttribute('aria-checked', 'false');
    });
    expect(remote.setRemoteCliAllowed).toHaveBeenLastCalledWith(7, false);
  });

  it('explains when the contact is not on the radio', async () => {
    const remote = makeRemote({ getRemoteCliAllowed: vi.fn(() => Promise.resolve(null)) });
    render(<MeshcoreRemoteCliSection nodeId={7} remote={remote} history={[]} disabled={false} />);
    openSection();
    expect(await screen.findByText(/isn't on your radio/i)).toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('sends commands and confirms destructive ones first', async () => {
    const remote = makeRemote();
    render(<MeshcoreRemoteCliSection nodeId={7} remote={remote} history={[]} disabled={false} />);
    const input = screen.getByRole('textbox', { name: 'Remote command' });
    fireEvent.change(input, { target: { value: 'ver' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => {
      expect(remote.sendRemoteCli).toHaveBeenCalledWith(7, 'ver', { confirmedDanger: false });
    });

    fireEvent.change(input, { target: { value: 'reboot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(remote.sendRemoteCli).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Run command' }));
    await waitFor(() => {
      expect(remote.sendRemoteCli).toHaveBeenLastCalledWith(7, 'reboot', {
        confirmedDanger: true,
      });
    });
  });

  it('shows the CLI history for this contact', () => {
    render(
      <MeshcoreRemoteCliSection
        nodeId={7}
        remote={makeRemote()}
        history={HISTORY}
        disabled={false}
      />,
    );
    expect(screen.getByText('> ver')).toBeInTheDocument();
    expect(screen.getByText('v1.18.0')).toBeInTheDocument();
  });

  it('has no axe violations when open', async () => {
    const { container } = render(
      <MeshcoreRemoteCliSection
        nodeId={7}
        remote={makeRemote()}
        history={HISTORY}
        onClearHistory={vi.fn()}
        disabled={false}
      />,
    );
    openSection();
    await screen.findByRole('switch');
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
