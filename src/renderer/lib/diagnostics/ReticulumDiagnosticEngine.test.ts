import { describe, expect, it } from 'vitest';

import type { RfDiagnosticRow } from '@/renderer/lib/types';

import {
  buildReticulumDiagnosticRows,
  mergeReticulumDiagnosticRows,
} from './ReticulumDiagnosticEngine';

describe('ReticulumDiagnosticEngine', () => {
  it('flags disabled RNS/LXMF and down interfaces', () => {
    const rows = buildReticulumDiagnosticRows({
      rns_ready: false,
      lxmf_ready: false,
      interface_count: 1,
      peer_count: 0,
      interfaces: [
        {
          id: 'tcp-1',
          name: 'Hub',
          type: 'tcp',
          enabled: true,
          status: 'down',
        },
      ],
    });
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/rns-not-ready')).toBe(
      true,
    );
    const rnsRow = rows.find(
      (r): r is RfDiagnosticRow => r.kind === 'rf' && r.condition === 'reticulum/rns-not-ready',
    );
    expect(rnsRow?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.rnsNotReady');
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/interface-down')).toBe(
      true,
    );
  });

  it('flags stale local serial port separately from generic interface-down', () => {
    const rows = buildReticulumDiagnosticRows(
      {
        rns_ready: true,
        lxmf_ready: true,
        interface_count: 1,
        peer_count: 1,
        interfaces: [
          {
            id: 'heltec',
            name: 'Heltec V3',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: '/dev/cu.usbserial-7',
          },
        ],
      },
      {
        interfaces: [
          {
            id: 'heltec',
            name: 'Heltec V3',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: '/dev/cu.usbserial-7',
          },
        ],
        osSerialPorts: ['/dev/cu.usbserial-0001'],
      },
    );
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/local-stale-port')).toBe(
      true,
    );
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/interface-down')).toBe(
      false,
    );
  });

  it('uses selfNodeId for audit and stack rows', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 0, peer_count: 0 },
      {
        selfNodeId: 99,
        auditIssues: [
          {
            kind: 'missing_auto_interface',
            severity: 'warning',
            message: 'no auto',
            repair_kind: 'add_auto',
          },
        ],
      },
    );
    expect(rows.every((r) => r.nodeId === 99)).toBe(true);
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/audit/missing_auto_interface'),
    ).toBe(true);
  });

  it('adds auto-beacon diagnostic rows from sidecar alert', () => {
    const physical = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 0 },
      {
        autoBeaconAlert: {
          kind: 'physical_failures',
          ifaceNames: ['en0'],
          suppressedCount: 0,
          lastAtMs: Date.now(),
        },
      },
    );
    expect(
      physical.some((r) => r.kind === 'rf' && r.condition === 'reticulum/auto-beacon-physical'),
    ).toBe(true);

    const tunnel = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 0 },
      {
        autoBeaconAlert: {
          kind: 'tunnel_only',
          ifaceNames: ['utun4'],
          suppressedCount: 12,
          lastAtMs: Date.now(),
        },
      },
    );
    expect(
      tunnel.some((r) => r.kind === 'rf' && r.condition === 'reticulum/auto-beacon-tunnel'),
    ).toBe(true);
  });

  it('mergeReticulumDiagnosticRows replaces prior reticulum rows', () => {
    const merged = mergeReticulumDiagnosticRows(
      [
        {
          kind: 'rf',
          id: 'old',
          nodeId: 1,
          condition: 'reticulum/interface-down',
          cause: 'old',
          severity: 'warning',
          detectedAt: 1,
        },
        {
          kind: 'routing',
          id: 'routing:1',
          nodeId: 2,
          type: 'hop_goblin',
          severity: 'error',
          description: 'keep',
          detectedAt: 1,
        },
      ],
      [
        {
          kind: 'rf',
          id: 'new',
          nodeId: 99,
          condition: 'reticulum/audit/ghost_interface',
          cause: 'new',
          severity: 'error',
          detectedAt: 2,
        },
      ],
    );
    expect(
      merged.filter(
        (r): r is RfDiagnosticRow => r.kind === 'rf' && r.condition.startsWith('reticulum/'),
      ),
    ).toHaveLength(1);
    expect(merged.some((r) => r.kind === 'routing')).toBe(true);
  });
});
