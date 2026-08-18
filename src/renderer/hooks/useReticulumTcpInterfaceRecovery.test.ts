import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

  function advancePastStartupGrace(): void {
    vi.advanceTimersByTime(RETICULUM_TCP_RECOVERY_STARTUP_GRACE_MS + 1_000);
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
          rttById: new Map([['ratspeak', 100]]),
          sidecarReady: true,
          connecting: false,
          interfaceIssueAlert: null,
          onRecover,
        },
      },
    );

    advancePastStartupGrace();

    for (const rtt of [101, 102, 103]) {
      await act(async () => {
        rerender({
          interfaces: [ratspeakHub],
          rttById: new Map([['ratspeak', rtt]]),
          sidecarReady: true,
          connecting: false,
          interfaceIssueAlert: null,
          onRecover,
        });
        await Promise.resolve();
        await Promise.resolve();
      });
    }

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
          rttById: new Map([['ratspeak', 100]]),
          sidecarReady: true,
          connecting: false,
          interfaceIssueAlert: { tcpResetByPeer: ['Ratspeak'] },
          onRecover,
        },
      },
    );

    advancePastStartupGrace();

    for (const rtt of [101, 102, 103, 104, 105]) {
      rerender({
        interfaces: [ratspeakHub],
        rttById: new Map([['ratspeak', rtt]]),
        sidecarReady: true,
        connecting: false,
        interfaceIssueAlert: { tcpResetByPeer: ['Ratspeak'] },
        onRecover,
      });
      await Promise.resolve();
    }

    await Promise.resolve();
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
          rttById: new Map([['ratspeak', 100]]),
          sidecarReady: true,
          connecting: false,
          interfaceIssueAlert: null,
          stackFastFlapSuspected: true,
          onRecover,
        },
      },
    );

    advancePastStartupGrace();

    for (const rtt of [101, 102, 103, 104, 105]) {
      rerender({
        interfaces: [ratspeakHub],
        rttById: new Map([['ratspeak', rtt]]),
        sidecarReady: true,
        connecting: false,
        interfaceIssueAlert: null,
        stackFastFlapSuspected: true,
        onRecover,
      });
      await Promise.resolve();
    }

    await Promise.resolve();
    expect(onRecover).not.toHaveBeenCalled();
  });
});
