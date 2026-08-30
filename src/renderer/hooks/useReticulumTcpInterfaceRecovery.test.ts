import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HOST_LINK_QUALITY_POLL_MS } from '@/renderer/lib/hostLinkQuality';
import { RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS } from '@/renderer/lib/reticulum/reticulumTcpInterfaceRecovery';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  fetchReticulumInterfaces: vi.fn(),
}));

import { fetchReticulumInterfaces } from '@/renderer/lib/reticulum/reticulumSidecarReads';

import { useReticulumTcpInterfaceRecovery } from './useReticulumTcpInterfaceRecovery';

const ratspeakHub = {
  id: 'ratspeak',
  name: 'Ratspeak',
  type: 'tcp',
  enabled: true,
  status: 'down',
  host: 'rns.ratspeak.org',
  port: 4242,
};

const storedRtt = new Map([['ratspeak', 100]]);

describe('useReticulumTcpInterfaceRecovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    vi.mocked(fetchReticulumInterfaces).mockResolvedValue([ratspeakHub]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  async function runBoundedPostReadyTicks(): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOST_LINK_QUALITY_POLL_MS);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(HOST_LINK_QUALITY_POLL_MS);
    });
  }

  it('invokes onRecover after sustained probe-ok / sidecar-down mismatch', async () => {
    const onRecover = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (props: Parameters<typeof useReticulumTcpInterfaceRecovery>[0]) => {
        useReticulumTcpInterfaceRecovery(props);
      },
      {
        initialProps: {
          interfaces: [ratspeakHub],
          rttById: storedRtt,
          sidecarReady: false,
          connecting: false,
          interfaceIssueAlert: null,
          onRecover,
        },
      },
    );

    rerender({
      interfaces: [ratspeakHub],
      rttById: storedRtt,
      sidecarReady: true,
      connecting: false,
      interfaceIssueAlert: null,
      onRecover,
    });

    await runBoundedPostReadyTicks();

    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it('falls back to snapshot rows when a bypassed interfaces fetch fails', async () => {
    vi.mocked(fetchReticulumInterfaces).mockRejectedValue(new Error('rate limit exceeded'));
    const onRecover = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (props: Parameters<typeof useReticulumTcpInterfaceRecovery>[0]) => {
        useReticulumTcpInterfaceRecovery(props);
      },
      {
        initialProps: {
          interfaces: [ratspeakHub],
          rttById: storedRtt,
          sidecarReady: false,
          connecting: false,
          interfaceIssueAlert: null,
          onRecover,
        },
      },
    );

    rerender({
      interfaces: [ratspeakHub],
      rttById: storedRtt,
      sidecarReady: true,
      connecting: false,
      interfaceIssueAlert: null,
      onRecover,
    });

    await runBoundedPostReadyTicks();

    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it('skips onRecover when the hub is actively resetting the session', async () => {
    const onRecover = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (props: Parameters<typeof useReticulumTcpInterfaceRecovery>[0]) => {
        useReticulumTcpInterfaceRecovery(props);
      },
      {
        initialProps: {
          interfaces: [ratspeakHub],
          rttById: storedRtt,
          sidecarReady: false,
          connecting: false,
          interfaceIssueAlert: { tcpResetByPeer: ['Ratspeak'] },
          onRecover,
        },
      },
    );

    rerender({
      interfaces: [ratspeakHub],
      rttById: storedRtt,
      sidecarReady: true,
      connecting: false,
      interfaceIssueAlert: { tcpResetByPeer: ['Ratspeak'] },
      onRecover,
    });

    await runBoundedPostReadyTicks();

    expect(onRecover).not.toHaveBeenCalled();
  });

  it('skips onRecover when stack fast-flap is suspected', async () => {
    const onRecover = vi.fn().mockResolvedValue(undefined);
    const { rerender } = renderHook(
      (props: Parameters<typeof useReticulumTcpInterfaceRecovery>[0]) => {
        useReticulumTcpInterfaceRecovery(props);
      },
      {
        initialProps: {
          interfaces: [ratspeakHub],
          rttById: storedRtt,
          sidecarReady: false,
          connecting: false,
          interfaceIssueAlert: null,
          stackFastFlapSuspected: true,
          onRecover,
        },
      },
    );

    rerender({
      interfaces: [ratspeakHub],
      rttById: storedRtt,
      sidecarReady: true,
      connecting: false,
      interfaceIssueAlert: null,
      stackFastFlapSuspected: true,
      onRecover,
    });

    await runBoundedPostReadyTicks();

    expect(onRecover).not.toHaveBeenCalled();
  });
});
