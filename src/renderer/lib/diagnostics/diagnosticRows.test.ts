import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
  DEFAULT_ROUTING_DIAGNOSTIC_MAX_AGE_MS,
  filterDiagnosticRowsForProtocol,
  pruneDiagnosticRowsByAge,
  replaceRfRowsForNode,
} from './diagnosticRows';

const routingRow = (nodeId: number, detectedAt: number) => ({
  kind: 'routing' as const,
  id: `routing:${nodeId}`,
  nodeId,
  type: 'bad_route' as const,
  severity: 'warning' as const,
  description: 'test',
  detectedAt,
});

const rfRow = (nodeId: number, detectedAt: number) => ({
  kind: 'rf' as const,
  id: `rf:${nodeId}:mesh_congestion`,
  nodeId,
  condition: 'Mesh Congestion',
  cause: 'dupes',
  severity: 'warning' as const,
  detectedAt,
});

const foreignLoraRfRow = (nodeId: number, detectedAt: number) => ({
  kind: 'rf' as const,
  id: `rf:${nodeId}:unknown_lora`,
  nodeId,
  condition: 'Unknown LoRa Traffic',
  cause: 'non-Meshtastic traffic',
  severity: 'info' as const,
  detectedAt,
});

const reticulumRfRow = (nodeId: number, detectedAt: number) => ({
  kind: 'rf' as const,
  id: `rf:${nodeId}:reticulum/interface-down/eth0`,
  nodeId,
  condition: 'reticulum/interface-down',
  cause: 'Interface is down',
  severity: 'error' as const,
  detectedAt,
});

describe('filterDiagnosticRowsForProtocol', () => {
  const t = 1_000_000;

  it('excludes Reticulum-native rows on Meshtastic tab', () => {
    const rows = [routingRow(1, t), reticulumRfRow(1, t)];
    const out = filterDiagnosticRowsForProtocol(rows, 'meshtastic');
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('routing');
  });

  it('excludes Reticulum-native rows on MeshCore tab', () => {
    const rows = [rfRow(2, t), reticulumRfRow(2, t)];
    const out = filterDiagnosticRowsForProtocol(rows, 'meshcore');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'rf', condition: 'Mesh Congestion' });
  });

  it('keeps only Reticulum-native rows on Reticulum tab', () => {
    const rows = [routingRow(3, t), reticulumRfRow(3, t), rfRow(3, t)];
    const out = filterDiagnosticRowsForProtocol(rows, 'reticulum');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'rf', condition: 'reticulum/interface-down' });
  });
});

describe('replaceRfRowsForNode', () => {
  it('preserves Foreign LoRa RF rows for the same node when replacing telemetry findings', () => {
    const t = 1_000_000;
    const rows = [foreignLoraRfRow(42, t), rfRow(42, t)];
    const out = replaceRfRowsForNode(rows, 42, []);
    expect(out.some((r) => r.kind === 'rf' && r.condition === 'Unknown LoRa Traffic')).toBe(true);
    expect(out.some((r) => r.kind === 'rf' && r.condition === 'Mesh Congestion')).toBe(false);
  });

  it('replaces telemetry RF rows for the node with new findings', () => {
    const t = 1_000_000;
    const rows = [rfRow(7, t)];
    const out = replaceRfRowsForNode(rows, 7, [
      {
        condition: 'Utilization vs. TX',
        cause: 'test',
        severity: 'warning',
      },
    ]);
    expect(out.some((r) => r.kind === 'rf' && r.condition === 'Utilization vs. TX')).toBe(true);
    expect(out.some((r) => r.kind === 'rf' && r.condition === 'Mesh Congestion')).toBe(false);
  });
});

describe('pruneDiagnosticRowsByAge', () => {
  it('keeps rows within routing max age', () => {
    const now = 1_000_000;
    const rows = [
      routingRow(1, now - 1000),
      routingRow(2, now - DEFAULT_ROUTING_DIAGNOSTIC_MAX_AGE_MS - 1),
    ];
    const out = pruneDiagnosticRowsByAge(rows, now, DEFAULT_ROUTING_DIAGNOSTIC_MAX_AGE_MS);
    expect(out).toHaveLength(1);
    expect(out[0].nodeId).toBe(1);
  });

  it('drops RF rows older than rf max age when rf max is shorter', () => {
    const now = 1_000_000;
    const rows = [rfRow(1, now - 1000), rfRow(2, now - DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS - 1)];
    const out = pruneDiagnosticRowsByAge(
      rows,
      now,
      DEFAULT_ROUTING_DIAGNOSTIC_MAX_AGE_MS,
      DEFAULT_RF_DIAGNOSTIC_MAX_AGE_MS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].nodeId).toBe(1);
  });

  it('uses routing max for RF when rf max not passed', () => {
    const now = 1_000_000;
    const max = 60_000;
    const rows = [rfRow(1, now - max - 1)];
    const out = pruneDiagnosticRowsByAge(rows, now, max);
    expect(out).toHaveLength(0);
  });
});
