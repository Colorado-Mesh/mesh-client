import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

const isReticulumSidecarRunning = vi.fn();
vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: () => isReticulumSidecarRunning(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) =>
      opts?.seconds != null ? `${key}:${opts.seconds}` : key,
  }),
}));

const addToast = vi.fn();
vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
}));

import { ReticulumPropagationEstablishRecoveryCallout } from './ReticulumPropagationEstablishRecoveryCallout';

describe('ReticulumPropagationEstablishRecoveryCallout', () => {
  const proxyGet = vi.fn();
  const proxyPost = vi.fn();
  const onRetrySync = vi.fn();
  const onOpenInterfaces = vi.fn();

  beforeEach(() => {
    cleanup();
    addToast.mockReset();
    onRetrySync.mockReset();
    onOpenInterfaces.mockReset();
    isReticulumSidecarRunning.mockResolvedValue(true);
    proxyGet.mockResolvedValue({
      interfaces: [
        { enabled: true, type: 'tcp' },
        { enabled: true, type: 'tcp' },
      ],
    });
    proxyPost.mockResolvedValue({ ok: true });
    window.electronAPI = {
      ...window.electronAPI,
      reticulum: {
        ...window.electronAPI?.reticulum,
        proxyGet,
        proxyPost,
      },
    };
    vi.useRealTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('is hidden when lastSyncError is null or generic failed', () => {
    const { rerender } = render(
      <ReticulumPropagationEstablishRecoveryCallout
        lastSyncError={null}
        retryTargetId="pn-aabb"
        syncBusy={false}
        onRetrySync={onRetrySync}
      />,
    );
    expect(screen.queryByTestId('propagation-establish-recovery')).not.toBeInTheDocument();

    rerender(
      <ReticulumPropagationEstablishRecoveryCallout
        lastSyncError="reticulumPropagation.syncFailed"
        retryTargetId="pn-aabb"
        syncBusy={false}
        onRetrySync={onRetrySync}
      />,
    );
    expect(screen.queryByTestId('propagation-establish-recovery')).not.toBeInTheDocument();
  });

  it.each([
    'reticulumPropagation.syncEstablishNoLinkProof',
    'reticulumPropagation.syncEstablishIdentityMissing',
    'reticulumPropagation.syncEstablishInvalidProof',
  ] as const)('shows recovery callout for %s', async (errorKey) => {
    render(
      <ReticulumPropagationEstablishRecoveryCallout
        lastSyncError={errorKey}
        retryTargetId="pn-aabb"
        syncBusy={false}
        onRetrySync={onRetrySync}
        onOpenInterfaces={onOpenInterfaces}
      />,
    );
    expect(screen.getByTestId('propagation-establish-recovery')).toBeInTheDocument();
    expect(screen.getByText('reticulumPropagation.establishRecoveryTitle')).toBeInTheDocument();
    expect(screen.getByText(errorKey)).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.getByText('reticulumPropagation.establishRecoveryDualTcpTip'),
      ).toBeInTheDocument();
    });
  });

  it('hides dual-TCP tip when fewer than two TCP interfaces are enabled', async () => {
    proxyGet.mockResolvedValue({
      interfaces: [{ enabled: true, type: 'tcp' }],
    });
    render(
      <ReticulumPropagationEstablishRecoveryCallout
        lastSyncError="reticulumPropagation.syncEstablishNoLinkProof"
        retryTargetId="pn-aabb"
        syncBusy={false}
        onRetrySync={onRetrySync}
        onOpenInterfaces={onOpenInterfaces}
      />,
    );
    await waitFor(() => {
      expect(proxyGet).toHaveBeenCalled();
    });
    expect(
      screen.queryByText('reticulumPropagation.establishRecoveryDualTcpTip'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'reticulumPropagation.establishRecoveryOpenInterfacesAria',
      }),
    ).not.toBeInTheDocument();
  });

  it('Announce now posts announces and enables Retry after settle wait', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPropagationEstablishRecoveryCallout
        lastSyncError="reticulumPropagation.syncEstablishNoLinkProof"
        retryTargetId="pn-aabb"
        syncBusy={false}
        onRetrySync={onRetrySync}
        announceWaitMs={40}
      />,
    );

    const retry = screen.getByRole('button', {
      name: 'reticulumPropagation.establishRecoveryRetryAria',
    });
    expect(retry).toBeEnabled();

    await user.click(
      screen.getByRole('button', {
        name: 'reticulumPropagation.establishRecoveryAnnounceAria',
      }),
    );
    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledWith('/api/v1/announces', {});
    });
    expect(addToast).toHaveBeenCalledWith('reticulumIdentity.announceNowDone', 'success');

    await waitFor(() => {
      expect(retry).toBeDisabled();
    });
    expect(
      screen.getByText(/reticulumPropagation\.establishRecoveryRetryWaiting:/),
    ).toBeInTheDocument();

    await waitFor(
      () => {
        expect(retry).toBeEnabled();
      },
      { timeout: 2000 },
    );
    await user.click(retry);
    expect(onRetrySync).toHaveBeenCalledWith('pn-aabb');
  });

  it('Open Interfaces CTA fires callback when dual-TCP tip is shown', async () => {
    const user = userEvent.setup();
    render(
      <ReticulumPropagationEstablishRecoveryCallout
        lastSyncError="reticulumPropagation.syncEstablishNoLinkProof"
        retryTargetId="pn-aabb"
        syncBusy={false}
        onRetrySync={onRetrySync}
        onOpenInterfaces={onOpenInterfaces}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByRole('button', {
          name: 'reticulumPropagation.establishRecoveryOpenInterfacesAria',
        }),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole('button', {
        name: 'reticulumPropagation.establishRecoveryOpenInterfacesAria',
      }),
    );
    expect(onOpenInterfaces).toHaveBeenCalledTimes(1);
  });

  it('has no axe violations on the callout subtree', async () => {
    proxyGet.mockResolvedValue({ interfaces: [{ enabled: true, type: 'tcp' }] });
    const { container } = render(
      <div className="bg-slate-900 p-2">
        <ReticulumPropagationEstablishRecoveryCallout
          lastSyncError="reticulumPropagation.syncEstablishNoLinkProof"
          retryTargetId="pn-aabb"
          syncBusy={false}
          onRetrySync={onRetrySync}
        />
      </div>,
    );
    const callout = screen.getByTestId('propagation-establish-recovery');
    hydrateAxeThemeColors(callout);
    expect(await axe(container)).toHaveNoViolations();
  });
});
