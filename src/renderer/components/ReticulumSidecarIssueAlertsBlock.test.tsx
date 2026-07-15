import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

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
  });
});
