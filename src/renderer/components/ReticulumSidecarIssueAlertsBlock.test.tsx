import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (opts && 'count' in opts) return `${key}:${String(opts.count)}`;
      if (opts && 'name' in opts) return `${key}:${String(opts.name)}`;
      if (opts && 'hash' in opts) return `${key}:${String(opts.hash)}`;
      return key;
    },
  }),
}));

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { ReticulumInterfaceIssueAlert } from '@/shared/reticulum-types';

import { ReticulumSidecarIssueAlertsBlock } from './ReticulumSidecarIssueAlertsBlock';

function baseAlert(
  partial: Partial<ReticulumInterfaceIssueAlert> = {},
): ReticulumInterfaceIssueAlert {
  return {
    tcpConnectFailed: [],
    txQueueDrops: [],
    linkDeliveryTimeouts: [],
    bleBondRemoved: [],
    blePairingTimedOut: [],
    transportSaturatedCount: 0,
    slowTransportQueryCount: 0,
    suppressedCount: 0,
    lastAtMs: Date.now(),
    ...partial,
  };
}

describe('ReticulumSidecarIssueAlertsBlock', () => {
  it('renders null when only link delivery timeouts are present', () => {
    const { container } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          linkDeliveryTimeouts: [{ destinationHash: '98046ee2aaaaaaaaaaaaaaaaaaaaaaaa', count: 1 }],
        })}
        shareInstanceEnabled
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(
      screen.queryByText(/connectionPanel.reticulumSidecarIssues.heading/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/connectionPanel.reticulumSidecarIssues.shareInstanceHint/),
    ).not.toBeInTheDocument();
  });

  it('shows TCP failures and omits link delivery timeouts from the list', () => {
    render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          tcpConnectFailed: ['RNS HAM RADIO'],
          linkDeliveryTimeouts: [{ destinationHash: '98046ee2aaaaaaaaaaaaaaaaaaaaaaaa', count: 1 }],
        })}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.heading:1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.tcpConnectFailed:RNS HAM RADIO'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/connectionPanel.reticulumSidecarIssues.linkDeliveryTimeout/),
    ).not.toBeInTheDocument();
  });

  it('shows share-instance hint for TX drops but not for link timeouts alone', () => {
    const { rerender } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          txQueueDrops: [{ name: 'Hub', dropCount: 3 }],
        })}
        shareInstanceEnabled
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.shareInstanceHint'),
    ).toBeInTheDocument();

    rerender(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          linkDeliveryTimeouts: [{ destinationHash: '98046ee2aaaaaaaaaaaaaaaaaaaaaaaa', count: 1 }],
        })}
        shareInstanceEnabled
      />,
    );
    expect(
      screen.queryByText('connectionPanel.reticulumSidecarIssues.shareInstanceHint'),
    ).not.toBeInTheDocument();
  });

  it('shows BLE bond-removed issue from sidecar alert', () => {
    render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          bleBondRemoved: ['RNode 41F4'],
        })}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.heading:1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.bleBondRemoved:RNode 41F4'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'connectionPanel.reticulumSidecarIssues.bleBondRemovedStopStack',
      }),
    ).not.toBeInTheDocument();
  });

  it('offers Stop stack and Open Admin actions when bleBondRemoved handlers are provided', async () => {
    const onStopStack = vi.fn().mockResolvedValue(undefined);
    const onOpenAdminBluetooth = vi.fn();
    const { container } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          bleBondRemoved: ['RNode 41F4'],
        })}
        onStopStack={onStopStack}
        onOpenAdminBluetooth={onOpenAdminBluetooth}
      />,
    );
    const stopBtn = screen.getByRole('button', {
      name: 'connectionPanel.reticulumSidecarIssues.bleBondRemovedStopStack',
    });
    const adminBtn = screen.getByRole('button', {
      name: 'connectionPanel.reticulumSidecarIssues.bleBondRemovedOpenAdmin',
    });
    stopBtn.click();
    adminBtn.click();
    expect(onStopStack).toHaveBeenCalledTimes(1);
    expect(onOpenAdminBluetooth).toHaveBeenCalledTimes(1);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows BLE pairing-timed-out issue from sidecar alert', async () => {
    const { container } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          blePairingTimedOut: ['RNode D5E7'],
        })}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.heading:1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.blePairingTimedOut:RNode D5E7'),
    ).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  const tcpIface = {
    id: 'rmap',
    name: 'RMAP World',
    type: 'tcp',
    enabled: true,
    status: 'down',
    serial_port: null as string | null,
  };
  const bleIface = {
    id: 'rnode-41f4',
    name: 'RNode 41F4',
    type: 'rnode',
    enabled: true,
    status: 'down',
    serial_port: 'ble://eccf2847-e1fd-3f5f-0811-064db1639a3d',
  };

  it('uses TCP TX-drop hint for TCP hubs', () => {
    render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          txQueueDrops: [{ name: 'RMAP World', dropCount: 512 }],
        })}
        interfaces={[tcpIface]}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHint'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBle'),
    ).not.toBeInTheDocument();
  });

  it('uses BLE TX-drop hint for BLE RNodes', () => {
    render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          txQueueDrops: [{ name: 'RNode 41F4', dropCount: 512 }],
        })}
        interfaces={[bleIface]}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBle'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHint'),
    ).not.toBeInTheDocument();
  });

  it('uses flow-control TX-drop hint for BLE RNodes with flow_control', async () => {
    const { container } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          txQueueDrops: [{ name: 'RNode 41F4', dropCount: 128 }],
        })}
        interfaces={[{ ...bleIface, flow_control: true }]}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBleFlowControl'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBle'),
    ).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses per-drop hints for mixed TCP + BLE (log regression)', async () => {
    const { container } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          txQueueDrops: [
            { name: 'RMAP World', dropCount: 512 },
            { name: 'RNode 41F4', dropCount: 512 },
          ],
        })}
        interfaces={[tcpIface, bleIface]}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.heading:2'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHint'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBle'),
    ).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('uses bond-stale TX hint and keeps Admin actions when bleBondRemoved co-occurs', () => {
    const onStopStack = vi.fn();
    const onOpenAdminBluetooth = vi.fn();
    render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          txQueueDrops: [{ name: 'RNode 41F4', dropCount: 512 }],
          bleBondRemoved: ['RNode 41F4'],
        })}
        interfaces={[bleIface]}
        onStopStack={onStopStack}
        onOpenAdminBluetooth={onOpenAdminBluetooth}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintBleBondStale'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'connectionPanel.reticulumSidecarIssues.bleBondRemovedStopStack',
      }),
    ).toBeInTheDocument();
  });

  it('falls back to neutral TX hint when interfaces are omitted', () => {
    render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          txQueueDrops: [{ name: 'RNode 41F4', dropCount: 512 }],
        })}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.txQueueDropsHintNeutral'),
    ).toBeInTheDocument();
  });

  it('renders hub RST with the unreachable/blocking hint', async () => {
    const { container } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          tcpResetByPeer: ['Ratspeak'],
        })}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.heading:1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.tcpResetByPeer:Ratspeak'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.tcpUnreachableHint'),
    ).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('renders hub EOF with the unreachable/blocking hint', async () => {
    const { container } = render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          tcpReadEof: ['Ratspeak'],
        })}
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.heading:1'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.tcpReadEof:Ratspeak'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('connectionPanel.reticulumLocalInterfaces.tcpUnreachableHint'),
    ).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows share-instance hint when the hub resets the TCP session', () => {
    render(
      <ReticulumSidecarIssueAlertsBlock
        alert={baseAlert({
          tcpResetByPeer: ['Ratspeak'],
        })}
        shareInstanceEnabled
      />,
    );
    expect(
      screen.getByText('connectionPanel.reticulumSidecarIssues.shareInstanceHint'),
    ).toBeInTheDocument();
  });
});
