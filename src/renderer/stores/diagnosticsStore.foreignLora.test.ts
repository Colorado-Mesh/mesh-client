import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  foreignLoraSenderKey,
  isLocallyDisplayableMeshcoreForeignLora,
  isPersistableForeignLoraDetection,
  useDiagnosticsStore,
} from './diagnosticsStore';

describe('foreignLoraSenderKey', () => {
  it('uses per-sender keys for meshcore', () => {
    expect(foreignLoraSenderKey('meshcore', 0xabc)).toBe('meshcore:2748');
    expect(foreignLoraSenderKey('meshcore')).toBe('meshcore:unknown');
    expect(foreignLoraSenderKey('meshcore', undefined, 'deadbeef')).toBe('meshcore:fp:deadbeef');
  });
});

describe('foreign lora persist filters', () => {
  it('keeps meshtastic-rf but drops distant meshcore-radio-rf', () => {
    const meshtastic = {
      detectedAt: Date.now(),
      count: 1,
      packetClass: 'meshtastic' as const,
      proximity: 'distant' as const,
      source: 'meshtastic-rf' as const,
    };
    const distantMeshcore = {
      detectedAt: Date.now(),
      count: 1,
      packetClass: 'meshcore' as const,
      proximity: 'distant' as const,
      source: 'meshcore-radio-rf' as const,
      lastSenderId: 99,
    };
    expect(isPersistableForeignLoraDetection(meshtastic)).toBe(true);
    expect(isPersistableForeignLoraDetection(distantMeshcore)).toBe(false);
    expect(isLocallyDisplayableMeshcoreForeignLora(distantMeshcore)).toBe(false);
  });
});

describe('getMeshcoreHeardByMeshtasticList', () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clearDiagnostics();
  });

  it('returns one entry per meshcore sender from Meshtastic RF', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -50, 10, 0x111, undefined, 'meshtastic-rf');
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -60, 8, 0x222, undefined, 'meshtastic-rf');
    const list = useDiagnosticsStore.getState().getMeshcoreHeardByMeshtasticList(100);
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.lastSenderId).sort()).toEqual([0x111, 0x222]);
  });

  it('excludes meshcore entries without RF overhear source', () => {
    useDiagnosticsStore.getState().recordForeignLora(100, 'meshcore', -50, 10, 0x111);
    expect(useDiagnosticsStore.getState().getMeshcoreHeardByMeshtasticList(100)).toHaveLength(0);
  });

  it('includes meshcore-radio-rf entries', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -42, 11, 0x444, undefined, 'meshcore-radio-rf');
    const list = useDiagnosticsStore.getState().getMeshcoreHeardByMeshtasticList(100);
    expect(list).toHaveLength(1);
    expect(list[0]?.lastSenderId).toBe(0x444);
    expect(list[0]?.source).toBe('meshcore-radio-rf');
  });

  it('does not store distant meshcore-radio-rf', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -108, 0.5, 0xdead, undefined, 'meshcore-radio-rf');
    expect(useDiagnosticsStore.getState().foreignLoraDetections.get(100)?.size ?? 0).toBe(0);
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -48, 12, 0xbeef, undefined, 'meshcore-radio-rf');
    const keys = [...(useDiagnosticsStore.getState().foreignLoraDetections.get(100)?.keys() ?? [])];
    expect(keys).toEqual(['meshcore:48879']);
  });

  it('stores nearby fingerprinted overhear', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -40, 5, undefined, undefined, 'meshtastic-rf', 'abc123');
    expect(
      useDiagnosticsStore.getState().foreignLoraDetections.get(100)?.has('meshcore:fp:abc123'),
    ).toBe(true);
  });

  it('stores meshcore:unknown in memory when nearby (no senderId, no fingerprint)', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -50, 9, undefined, undefined, 'meshtastic-rf');
    expect(
      useDiagnosticsStore.getState().foreignLoraDetections.get(100)?.has('meshcore:unknown'),
    ).toBe(true);
  });

  it('promotes meshcore:unknown to identified entry when senderId arrives', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -50, 9, undefined, undefined, 'meshtastic-rf');
    expect(
      useDiagnosticsStore.getState().foreignLoraDetections.get(100)?.has('meshcore:unknown'),
    ).toBe(true);

    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -48, 9, 0xaabb, undefined, 'meshtastic-rf');
    const bySender = useDiagnosticsStore.getState().foreignLoraDetections.get(100);
    expect(bySender?.has('meshcore:unknown')).toBe(false);
    expect(bySender?.has('meshcore:43707')).toBe(true); // 0xaabb in decimal
  });

  it('does not persist meshcore:unknown to localStorage', () => {
    vi.useFakeTimers();
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -50, 9, undefined, undefined, 'meshtastic-rf');
    vi.advanceTimersByTime(600); // past 500ms debounce
    const raw = localStorage.getItem('mesh-client:foreignLoraDetectionsSnapshot');
    const parsed = raw ? (JSON.parse(raw) as { entries?: [number, [string, unknown][]][] }) : null;
    const senderKeys = parsed?.entries?.flatMap(([, pairs]) => pairs.map(([k]) => k)) ?? [];
    expect(senderKeys).not.toContain('meshcore:unknown');
    vi.useRealTimers();
  });

  it('does not store meshcore:unknown when distant (rssi below -95)', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'meshcore', -100, undefined, undefined, undefined, 'meshtastic-rf');
    expect(
      useDiagnosticsStore.getState().foreignLoraDetections.get(100)?.has('meshcore:unknown'),
    ).toBe(false);
  });

  it('does not store unknown-lora detections (pruned immediately)', () => {
    useDiagnosticsStore
      .getState()
      .recordForeignLora(100, 'unknown-lora', -60, 5, undefined, undefined, 'meshtastic-rf');
    expect(useDiagnosticsStore.getState().foreignLoraDetections.get(100)?.size ?? 0).toBe(0);
  });
});
