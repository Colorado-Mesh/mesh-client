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
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/tcp-unreachable')).toBe(
      true,
    );
  });

  it('flags unreachable TCP hubs with tcp-unreachable condition', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        interfaces: [
          {
            id: 'ham',
            name: 'RNS HAM RADIO',
            type: 'tcp',
            enabled: true,
            status: 'down',
            host: '135.125.238.229',
            port: 4242,
          },
        ],
      },
    );
    const row = rows.find(
      (r): r is RfDiagnosticRow => r.kind === 'rf' && r.condition === 'reticulum/tcp-unreachable',
    );
    expect(row).toBeDefined();
    expect(row?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.tcpUnreachable');
    expect(row?.reticulumRepairKind).toBe('disable');
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/interface-down')).toBe(
      false,
    );
  });

  it('adds sidecar interface issue rows for tcp failures and tx drops', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        interfaces: [
          {
            id: 'ham',
            name: 'RNS HAM RADIO',
            type: 'tcp',
            enabled: true,
            status: 'up',
            host: '135.125.238.229',
            port: 4242,
          },
        ],
        interfaceIssueAlert: {
          tcpConnectFailed: ['RNS HAM RADIO'],
          txQueueDrops: [{ name: 'RNS HAM RADIO', dropCount: 128 }],
          linkDeliveryTimeouts: [],
          transportSaturatedCount: 0,
          slowTransportQueryCount: 0,
          suppressedCount: 0,
          lastAtMs: Date.now(),
        },
      },
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/tcp-connect-failed'),
    ).toBe(true);
    expect(rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/tx-queue-drops')).toBe(
      true,
    );
    const dropRow = rows.find(
      (r): r is RfDiagnosticRow => r.kind === 'rf' && r.condition === 'reticulum/tx-queue-drops',
    );
    expect(dropRow?.severity).toBe('error');
  });

  it('adds link timeout and transport saturation rows from sidecar alerts', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        interfaceIssueAlert: {
          tcpConnectFailed: [],
          txQueueDrops: [],
          linkDeliveryTimeouts: [{ destinationHash: '5526a65d0b4d23448206fd3485b76f5b', count: 3 }],
          transportSaturatedCount: 42,
          slowTransportQueryCount: 2,
          suppressedCount: 0,
          lastAtMs: Date.now(),
        },
        shareInstanceEnabled: true,
      },
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/link-delivery-timeout'),
    ).toBe(true);
    const linkTimeout = rows.find(
      (r): r is RfDiagnosticRow =>
        r.kind === 'rf' && r.condition === 'reticulum/link-delivery-timeout',
    );
    expect(linkTimeout?.severity).toBe('warning');
    const saturated = rows.find(
      (r): r is RfDiagnosticRow =>
        r.kind === 'rf' && r.condition === 'reticulum/transport-saturated',
    );
    expect(saturated?.causeI18n?.key).toBe(
      'diagnosticsPanel.reticulum.runtime.transportSaturatedShareInstance',
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/slow-transport-query'),
    ).toBe(true);
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

  it('omits runtime_only_interface audit notes from diagnostic rows', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 0 },
      {
        auditIssues: [
          {
            kind: 'runtime_only_interface',
            severity: 'info',
            interface_id: 'shared',
            interface_name: 'SharedInstanceServer',
            message: 'Runtime shared-instance server (not in config)',
          },
        ],
      },
    );
    expect(
      rows.some(
        (r): r is RfDiagnosticRow =>
          r.kind === 'rf' && r.condition === 'reticulum/audit/runtime_only_interface',
      ),
    ).toBe(false);
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
