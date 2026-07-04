import { beforeEach, describe, expect, it } from 'vitest';

import {
  parseTcpConnectFailedIfaceForTests,
  parseTxDropIfaceForTests,
  ReticulumSidecarInterfaceIssueTracker,
} from './reticulumSidecarIssueTracker';

const TCP_LINE =
  '[2m2026-07-03T22:38:51.145492Z [0m [33m WARN [0m [2mrns_interface::tcp [0m [2m: [0m TCP connect failed [3mname [0m [2m= [0mRNS HAM RADIO [3merror [0m [2m= [0mConnection refused (os error 61)';

const TX_DROP_LINE =
  '[2m2026-07-03T22:56:04.991728Z [0m [31mERROR [0m [2mrns_transport::actor [0m [2m: [0m PACKET DROPPED: interface TX channel full [3minterface_id [0m [2m= [0m3 [3minterface_name [0m [2m= [0mRNS HAM RADIO [3mqueue_remaining [0m [2m= [0m0 [3mqueue_max [0m [2m= [0m1024 [3mtx_drops [0m [2m= [0m8192';

describe('ReticulumSidecarInterfaceIssueTracker', () => {
  let tracker: ReticulumSidecarInterfaceIssueTracker;

  beforeEach(() => {
    tracker = new ReticulumSidecarInterfaceIssueTracker();
  });

  it('parses TCP connect failed interface names from sidecar log lines', () => {
    expect(parseTcpConnectFailedIfaceForTests(TCP_LINE)).toBe('RNS HAM RADIO');
  });

  it('parses TX queue drop interface names from sidecar log lines', () => {
    expect(parseTxDropIfaceForTests(TX_DROP_LINE)).toBe('RNS HAM RADIO');
  });

  it('builds alert with tcp and tx drop issues', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.recordLine(TX_DROP_LINE, 2_000);
    const alert = tracker.getAlert(2_500);
    expect(alert).toEqual({
      tcpConnectFailed: ['RNS HAM RADIO'],
      txQueueDrops: [{ name: 'RNS HAM RADIO', dropCount: 8192 }],
      suppressedCount: 0,
      lastAtMs: 2_000,
    });
  });

  it('expires alerts after stale window', () => {
    tracker.recordLine(TCP_LINE, 0);
    expect(tracker.getAlert(4 * 60_000)).not.toBeNull();
    expect(tracker.getAlert(6 * 60_000)).toBeNull();
  });
});
