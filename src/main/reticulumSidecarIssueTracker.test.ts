import { beforeEach, describe, expect, it } from 'vitest';

import {
  parseLinkDeliveryTimeoutDestForTests,
  parseTcpConnectFailedIfaceForTests,
  parseTxDropIfaceForTests,
  ReticulumSidecarInterfaceIssueTracker,
} from './reticulumSidecarIssueTracker';

const TCP_LINE =
  '[2m2026-07-03T22:38:51.145492Z [0m [33m WARN [0m [2mrns_interface::tcp [0m [2m: [0m TCP connect failed [3mname [0m [2m= [0mRNS HAM RADIO [3merror [0m [2m= [0mConnection refused (os error 61)';

const TX_DROP_LINE =
  '[2m2026-07-03T22:56:04.991728Z [0m [31mERROR [0m [2mrns_transport::actor [0m [2m: [0m PACKET DROPPED: interface TX channel full [3minterface_id [0m [2m= [0m3 [3minterface_name [0m [2m= [0mRNS HAM RADIO [3mqueue_remaining [0m [2m= [0m0 [3mqueue_max [0m [2m= [0m1024 [3mtx_drops [0m [2m= [0m8192';

const LINK_TIMEOUT_LINE =
  'link delivery timed out dest=5526a65d0b4d23448206fd3485b76f5b state=Establishing timeout_secs=18.0 reason="link establishment timeout"';

const PATH_REQUEST_SATURATED_LINE =
  'failed to queue path request for LXMF delivery to 5526a65d0b4d23448206fd3485b76f5b (transport channel full)';

const SLOW_TRANSPORT_LINE =
  'transport query slow or failed query=GetInterfaceStats elapsed_ms=8123';

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

  it('parses link delivery timeout destination hash', () => {
    expect(parseLinkDeliveryTimeoutDestForTests(LINK_TIMEOUT_LINE)).toBe(
      '5526a65d0b4d23448206fd3485b76f5b',
    );
  });

  it('builds alert with tcp and tx drop issues', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.recordLine(TX_DROP_LINE, 2_000);
    const alert = tracker.getAlert(2_500);
    expect(alert).toEqual({
      tcpConnectFailed: ['RNS HAM RADIO'],
      txQueueDrops: [{ name: 'RNS HAM RADIO', dropCount: 8192 }],
      linkDeliveryTimeouts: [],
      transportSaturatedCount: 0,
      slowTransportQueryCount: 0,
      suppressedCount: 0,
      lastAtMs: 2_000,
    });
  });

  it('tracks link timeouts, transport saturation, and slow transport queries', () => {
    tracker.recordLine(LINK_TIMEOUT_LINE, 1_000);
    tracker.recordLine(LINK_TIMEOUT_LINE, 1_500);
    tracker.recordLine(PATH_REQUEST_SATURATED_LINE, 2_000);
    tracker.recordLine(PATH_REQUEST_SATURATED_LINE, 2_100);
    tracker.recordLine(SLOW_TRANSPORT_LINE, 2_200);
    const alert = tracker.getAlert(2_500);
    expect(alert?.linkDeliveryTimeouts).toEqual([
      { destinationHash: '5526a65d0b4d23448206fd3485b76f5b', count: 2 },
    ]);
    expect(alert?.transportSaturatedCount).toBe(2);
    expect(alert?.slowTransportQueryCount).toBe(1);
  });

  it('expires alerts after stale window', () => {
    tracker.recordLine(TCP_LINE, 0);
    expect(tracker.getAlert(4 * 60_000)).not.toBeNull();
    expect(tracker.getAlert(6 * 60_000)).toBeNull();
  });
});
