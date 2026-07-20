import { beforeEach, describe, expect, it } from 'vitest';

import { RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS } from '../shared/reticulum-types';
import {
  parseBleBondRemovedIfaceForTests,
  parseBlePairingTimedOutIfaceForTests,
  parseLinkDeliveryTimeoutDestForTests,
  parseTcpConnectFailedIfaceForTests,
  parseTxDropIfaceForTests,
  ReticulumSidecarInterfaceIssueTracker,
} from './reticulumSidecarIssueTracker';

const TCP_LINE =
  '[2m2026-07-03T22:38:51.145492Z [0m [33m WARN [0m [2mrns_interface::tcp [0m [2m: [0m TCP connect failed [3mname [0m [2m= [0mRNS HAM RADIO [3merror [0m [2m= [0mConnection refused (os error 61)';

const TCP_LINE_DUBLIN =
  'TCP connect failed name = RNS Testnet Dublin error = Connection refused (os error 61)';

const TX_DROP_LINE =
  '[2m2026-07-03T22:56:04.991728Z [0m [31mERROR [0m [2mrns_transport::actor [0m [2m: [0m PACKET DROPPED: interface TX channel full [3minterface_id [0m [2m= [0m3 [3minterface_name [0m [2m= [0mRNS HAM RADIO [3mqueue_remaining [0m [2m= [0m0 [3mqueue_max [0m [2m= [0m1024 [3mtx_drops [0m [2m= [0m8192';

const LINK_TIMEOUT_LINE =
  'link delivery timed out dest=5526a65d0b4d23448206fd3485b76f5b state=Establishing timeout_secs=18.0 reason="link establishment timeout"';

const PATH_REQUEST_SATURATED_LINE =
  'failed to queue path request for LXMF delivery to 5526a65d0b4d23448206fd3485b76f5b (transport channel full)';

const SLOW_TRANSPORT_LINE =
  'transport query slow or failed query=GetInterfaceStats elapsed_ms=8123';

const BLE_BOND_REMOVED_LINE =
  'BLE RNode connect failed name = RNode 41F4 error = send failed: BLE connect failed after 3 attempts: Runtime Error: Peer removed pairing information';

const BLE_BOND_ATTEMPT_LINE =
  'BLE RNode connect attempt failed attempt = 1 error = Runtime Error: Peer removed pairing information';

const BLE_PAIRING_TIMED_OUT_LINE =
  'BLE RNode connect failed name = RNode D5E7 error = send failed: BLE pairing timed out. Did you enter the 6-digit passkey shown on the RNode when the system prompted?';

const BLE_PAIRING_IN_PROGRESS_LINE =
  'BLE RNode connect failed name = RNode D5E7 error = send failed: BLE pairing in progress: Runtime Error: Device disconnected';

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

  it('parses BLE bond-removed interface names only from named connect-failed lines', () => {
    expect(parseBleBondRemovedIfaceForTests(BLE_BOND_REMOVED_LINE)).toBe('RNode 41F4');
    expect(parseBleBondRemovedIfaceForTests(BLE_BOND_ATTEMPT_LINE)).toBeNull();
  });

  it('parses BLE pairing-timed-out interface names only from named connect-failed lines', () => {
    expect(parseBlePairingTimedOutIfaceForTests(BLE_PAIRING_TIMED_OUT_LINE)).toBe('RNode D5E7');
    expect(parseBlePairingTimedOutIfaceForTests(BLE_PAIRING_IN_PROGRESS_LINE)).toBeNull();
  });

  it('builds alert with BLE bond-removed issues', () => {
    tracker.recordLine(BLE_BOND_ATTEMPT_LINE, 500);
    tracker.recordLine(BLE_BOND_REMOVED_LINE, 1_000);
    const alert = tracker.getAlert(1_500);
    expect(alert?.bleBondRemoved).toEqual(['RNode 41F4']);
    expect(alert?.lastAtMs).toBe(1_000);
  });

  it('builds alert with BLE pairing-timed-out issues', () => {
    tracker.recordLine(BLE_PAIRING_IN_PROGRESS_LINE, 500);
    tracker.recordLine(BLE_PAIRING_TIMED_OUT_LINE, 1_000);
    const alert = tracker.getAlert(1_500);
    expect(alert?.blePairingTimedOut).toEqual(['RNode D5E7']);
    expect(alert?.bleBondRemoved).toEqual([]);
    expect(alert?.lastAtMs).toBe(1_000);
  });

  it('builds alert with tcp and tx drop issues', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.recordLine(TX_DROP_LINE, 2_000);
    const alert = tracker.getAlert(2_500);
    expect(alert).toEqual({
      tcpConnectFailed: ['RNS HAM RADIO'],
      txQueueDrops: [{ name: 'RNS HAM RADIO', dropCount: 8192 }],
      linkDeliveryTimeouts: [],
      bleBondRemoved: [],
      blePairingTimedOut: [],
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
    expect(alert?.lastAtMs).toBe(2_200);
  });

  it('expires alerts after stale window and purges entries (no resurrection)', () => {
    tracker.recordLine(TCP_LINE, 0);
    expect(tracker.getAlert(4 * 60_000)).not.toBeNull();
    expect(tracker.getAlert(6 * 60_000)).toBeNull();
    // Unrelated issue after TTL must not resurrect the old TCP name.
    tracker.recordLine(PATH_REQUEST_SATURATED_LINE, 6 * 60_000 + 1_000);
    const alert = tracker.getAlert(6 * 60_000 + 1_500);
    expect(alert?.tcpConnectFailed).toEqual([]);
    expect(alert?.transportSaturatedCount).toBe(1);
  });

  it('retainInterfaces drops disabled or removed interface names', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.recordLine(TCP_LINE_DUBLIN, 1_100);
    tracker.recordLine(TX_DROP_LINE, 1_200);
    tracker.retainInterfaces(new Set(['RNS Testnet Dublin']));
    const alert = tracker.getAlert(1_500);
    expect(alert?.tcpConnectFailed).toEqual(['RNS Testnet Dublin']);
    expect(alert?.txQueueDrops).toEqual([]);
  });

  it('retainInterfaces clears alert when all TCP/TX names are disabled', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.retainInterfaces(new Set());
    expect(tracker.getAlert(1_500)).toBeNull();
  });

  it('retainInterfaces preserves stack-wide transport counters', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.recordLine(LINK_TIMEOUT_LINE, 1_100);
    tracker.recordLine(PATH_REQUEST_SATURATED_LINE, 1_200);
    tracker.recordLine(SLOW_TRANSPORT_LINE, 1_300);
    tracker.retainInterfaces(new Set());
    const alert = tracker.getAlert(1_500);
    expect(alert?.tcpConnectFailed).toEqual([]);
    expect(alert?.txQueueDrops).toEqual([]);
    expect(alert?.linkDeliveryTimeouts).toHaveLength(1);
    expect(alert?.transportSaturatedCount).toBe(1);
    expect(alert?.slowTransportQueryCount).toBe(1);
  });

  it('sticky retainInterfaces rejects later log lines for disabled names', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.retainInterfaces(new Set(['RNS Testnet Dublin']));
    tracker.recordLine(TCP_LINE, 1_200);
    tracker.recordLine(TX_DROP_LINE, 1_300);
    expect(tracker.getAlert(1_500)?.tcpConnectFailed ?? []).toEqual([]);
    expect(tracker.getAlert(1_500)?.txQueueDrops ?? []).toEqual([]);
    tracker.recordLine(TCP_LINE_DUBLIN, 1_400);
    expect(tracker.getAlert(1_500)?.tcpConnectFailed).toEqual(['RNS Testnet Dublin']);
  });

  it('clear empties the alert immediately', () => {
    tracker.recordLine(TCP_LINE, 1_000);
    tracker.recordLine(PATH_REQUEST_SATURATED_LINE, 1_100);
    tracker.clear();
    expect(tracker.getAlert(1_500)).toBeNull();
  });

  it('prunes individual entries by their own timestamps', () => {
    tracker.recordLine(TCP_LINE, 0);
    tracker.recordLine(TCP_LINE_DUBLIN, RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS - 10_000);
    const alert = tracker.getAlert(RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS + 1_000);
    expect(alert?.tcpConnectFailed).toEqual(['RNS Testnet Dublin']);
  });
});
