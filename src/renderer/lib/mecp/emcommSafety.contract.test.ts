/**
 * EMCOMM safety invariant registry (source contracts). Keep this list in sync with
 * docs/agents/emcomm.md — add an assert here when a workstream lands the invariant.
 *
 * S1  MECP compose send path uses the emergency outbox (not bare handleSendChunk only).
 * S2  Emergency rows ignore the 24h age / 5-attempt stop; the soft row cap blocks (never deletes)
 *     active distress rows.
 * S3  Offline / send-fail MAYDAY still enqueues and drains on reconnect.
 * S4  Watcher hydration seeds without alert/audit.
 * S5  Sev 0/1 bypass mute; drills never alert.
 * S6  Cross-protocol rebroadcast does not duplicate incidents.
 * S7  B02/B03 do not open new incidents; B02 is not the general ACK compose.
 * S8  Incident tab lazy export is mounted in App.
 * S9  Tab badge counts open sev 0/1 only.
 * S10 Manual disconnect does not fire link-down / does not cancel emergency outbox retries.
 * S11 Link-down suppressed while RF reconnect is in progress.
 * S12 Incident-open nodes exempt from position_history prune.
 * S13 USGS/topo tiles only via allowlisted hosts; no user URL template.
 * S14 `mecpComposeEnabled` default remains `false`.
 * S15 Incident ACKs queue as normal priority; recordAck only on live `'sent'` (drain path tags viewKey).
 * S16 App mounts emergency+ACK outbox drain once for all protocols.
 * Beacon cancel: resolving an originated beacon sends B03 via sendEmergencyText (beaconCancel.ts).
 *
 * Behavioral coverage for S2/S3 lives in useChatOutbox.test.ts and emergencySend.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { composeBeaconAck, composeGeneralAck } from './mecpAck';

const RENDERER = join(__dirname, '..', '..');
const SRC = join(RENDERER, '..');

function readSrc(relFromSrc: string): string {
  return readFileSync(join(SRC, relFromSrc), 'utf8');
}

describe('EMCOMM safety invariants (source contracts)', () => {
  it('S14: mecpComposeEnabled defaults to false', () => {
    const defaults = readSrc('renderer/lib/defaultAppSettings.ts');
    expect(defaults).toMatch(/mecpComposeEnabled:\s*false/);
    expect(defaults).not.toMatch(/mecpMaydayButtonEnabled/);
    expect(defaults).not.toMatch(/quickStatusBarEnabled/);
  });

  it('S2: OutboxEntry carries a normal/emergency priority', () => {
    const types = readSrc('shared/electron-api.types.ts');
    expect(types).toMatch(/interface OutboxEntry \{[\s\S]*?priority: OutboxPriority;/);
    expect(types).toMatch(/export type OutboxPriority = 'normal' \| 'emergency';/);
  });

  it('S2: useChatOutbox exempts App-managed (emergency + ACK) rows from the age/attempt caps', () => {
    const hook = readSrc('renderer/hooks/useChatOutbox.ts');
    expect(hook).toMatch(/export const EMERGENCY_OUTBOX_SOFT_CAP = \d+;/);
    expect(hook).toMatch(
      /isAppManagedOutboxRow\(row\) \|\| now - row\.createdAt <= OUTBOX_MAX_AGE_MS/,
    );
    expect(hook).toMatch(/isAppManagedOutboxRow\(row\) \|\| nextAttemptCount < MAX_ATTEMPTS/);
  });

  it('S1: emergencySend module exists and MECP compose routes through it', () => {
    expect(existsSync(join(RENDERER, 'lib', 'emergencySend.ts'))).toBe(true);
    expect(readSrc('renderer/lib/emergencySend.ts')).toMatch(/priority: 'emergency'/);
    const panel = readSrc('renderer/components/ChatPanel.tsx');
    expect(panel).toMatch(/<MecpComposeModal[\s\S]*?sendEmergencyText\(/);
  });

  it('S6: incident fingerprint omits protocol (cross-protocol merge)', () => {
    const msgs = readSrc('renderer/lib/mecp/mecpMessages.ts');
    expect(msgs).toMatch(/function incidentFingerprint|export function incidentFingerprint/);
    expect(msgs).not.toMatch(/incidentFingerprint\([\s\S]*?protocol[\s\S]*?\}:\s*string/);
    const store = readSrc('renderer/stores/incidentStore.ts');
    expect(store).toMatch(/protocolsSeen/);
  });

  it('S7: B02 is beacon ack only; general ack uses R01', () => {
    const ack = readSrc('renderer/lib/mecp/mecpAck.ts');
    expect(ack).toMatch(/MECP_BEACON_ACK_CODE = 'B02'/);
    expect(ack).toMatch(/MECP_ACK_CODE = 'R01'/);
    expect(ack).toMatch(/composeBeaconAck[\s\S]*?MECP_BEACON_ACK_CODE/);
    expect(ack).toMatch(/composeGeneralAck[\s\S]*?MECP_ACK_CODE/);
  });

  it('S7: composed beacon ACK carries B02; composed general ACK never does', () => {
    expect(composeBeaconAck(0)).toMatch(/^MECP\/0\/B02/);
    expect(composeGeneralAck(0, ['B01', 'B02', 'M01'])).not.toMatch(/\/B02|\bB02\b/);
    expect(composeGeneralAck(0, ['M01'])).toMatch(/^MECP\/0\/R01 M01/);
  });

  it('S8: IncidentPanel is lazy-exported and mounted in App', () => {
    expect(readSrc('renderer/lazyTabPanels.ts')).toMatch(/export const IncidentPanel = lazy\(/);
    expect(readSrc('renderer/App.tsx')).toMatch(/<IncidentPanel/);
  });

  it('S9: Sidebar badges open sev 0/1 incidents', () => {
    expect(readSrc('renderer/components/Sidebar.tsx')).toMatch(/slotId === 'Incident'/);
    expect(readSrc('renderer/stores/incidentStore.ts')).toMatch(/openMaydayUrgentCount/);
  });

  it('S14 remains: mecp compose defaults false (duplicate guard)', () => {
    const defaults = readSrc('renderer/lib/defaultAppSettings.ts');
    expect(defaults).toMatch(/mecpComposeEnabled:\s*false/);
  });

  it('S10/S11: link-down predicate excludes manual disconnect and in-progress reconnect', () => {
    const pred = readSrc('renderer/lib/operationalAlerts.ts');
    expect(pred).toMatch(/!opts\.isManualDisconnect/);
    expect(pred).toMatch(/!opts\.isReconnectInProgress/);
    const hook = readSrc('renderer/hooks/useOperationalAlerts.ts');
    expect(hook).toMatch(/isManualDisconnect: link\.connectionLoss !== true/);
    expect(hook).toMatch(/link\.status === 'reconnecting' \|\| link\.status === 'connecting'/);
    expect(readSrc('renderer/App.tsx')).toMatch(/useOperationalAlerts\(\{/);
  });

  it('S10: ops alerts never touch the outbox (manual disconnect cannot cancel emergency retries)', () => {
    expect(readSrc('renderer/hooks/useOperationalAlerts.ts')).not.toMatch(/outbox/i);
  });

  it('S15: incident ACKs queue as normal priority and only record ACK when actually sent', () => {
    const app = readSrc('renderer/App.tsx');
    const ack = /const handleIncidentAck = useCallback\([\s\S]*?\n {2}\);/.exec(app)?.[0] ?? '';
    expect(ack).toMatch(/sendTextWithOutboxFallback\(/);
    expect(ack).toMatch(/'normal',\s*\)/);
    expect(ack).not.toMatch(/sendEmergencyText\(/);
    expect(ack).toMatch(/incidentAckViewKey\(/);
    expect(ack).toMatch(/if \(outcome === 'sent'\) \{[\s\S]*?confirmBeacon[\s\S]*?recordAck/);
  });

  it('originated beacon resolve sends B03 through the emergency outbox', () => {
    const app = readSrc('renderer/App.tsx');
    expect(app).toMatch(/resolveIncidentWithBeaconCancel\(/);
    expect(app).toMatch(/onResolve=\{handleIncidentResolve\}/);
    const cancel = readSrc('renderer/lib/mecp/beaconCancel.ts');
    expect(cancel).toMatch(/composeBeaconCancel\(/);
    expect(cancel).toMatch(/sendEmergencyText\(/);
  });

  it('S16: App mounts the emergency outbox drain once for all protocols', () => {
    const app = readSrc('renderer/App.tsx');
    expect(app.match(/useEmergencyOutboxDrain\(\{/g)).toHaveLength(1);
    expect(app).toMatch(/REGISTERED_MESH_PROTOCOLS\.map\(\(p\) => \(\{/);
    expect(readSrc('renderer/hooks/useEmergencyOutboxDrain.ts')).toMatch(/isAppManagedOutboxRow/);
  });

  it('S12: startup and session prune pass incident-exempt node ids; main excludes them', () => {
    const hook = readSrc('renderer/hooks/useAppStartupDbPrune.ts');
    expect(hook).toMatch(/nodesExemptFromPositionPrune\(/);
    expect(hook).toMatch(/runStartupDbPrune\(incidentPruneOptions\(\)\)/);
    expect(hook).toMatch(/runSessionDbPrune\(incidentPruneOptions\(\)\)/);
    const db = readSrc('main/database.ts');
    expect(db).toMatch(/node_id NOT IN \(SELECT value FROM json_each\(\?\)\)/);
  });

  it('S13: USGS topo is allowlisted only (no user URL templates)', () => {
    const reg = readSrc('shared/offlineMaps/basemapRegistry.ts');
    expect(reg).toMatch(/usgs-topo|usgsTopo/);
    expect(reg).not.toMatch(/userTileUrl|customTileTemplate/);
  });
});
