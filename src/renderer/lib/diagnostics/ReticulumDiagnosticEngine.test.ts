import { describe, expect, it, vi } from 'vitest';

import type { RfDiagnosticRow } from '@/renderer/lib/types';

import {
  buildReticulumDiagnosticRows,
  mergeReticulumDiagnosticRows,
  RETICULUM_ANNOUNCE_BUS_PRESSURE_TTL_MS,
  shouldEmitAnnounceBusPressure,
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
          bleBondRemoved: [],
          blePairingTimedOut: [],
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

  it('adds bleBondRemoved runtime rows from sidecar alerts', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 0 },
      {
        interfaces: [
          {
            id: 'ble1',
            name: 'RNode BLE',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        interfaceIssueAlert: {
          tcpConnectFailed: [],
          txQueueDrops: [],
          linkDeliveryTimeouts: [],
          bleBondRemoved: ['RNode BLE'],
          blePairingTimedOut: [],
          transportSaturatedCount: 0,
          slowTransportQueryCount: 0,
          suppressedCount: 0,
          lastAtMs: Date.now(),
        },
      },
    );
    const bondRow = rows.find(
      (r): r is RfDiagnosticRow => r.kind === 'rf' && r.condition === 'reticulum/ble-bond-removed',
    );
    expect(bondRow).toBeDefined();
    expect(bondRow?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.bleBondRemoved');
    expect(bondRow?.causeI18n?.params).toEqual({ name: 'RNode BLE' });
  });

  it('adds blePairingTimedOut runtime rows from sidecar alerts', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 0 },
      {
        interfaces: [
          {
            id: 'ble1',
            name: 'RNode D5E7',
            type: 'rnode',
            enabled: true,
            status: 'down',
            serial_port: 'ble://AA:BB:CC:DD:EE:FF',
          },
        ],
        interfaceIssueAlert: {
          tcpConnectFailed: [],
          txQueueDrops: [],
          linkDeliveryTimeouts: [],
          bleBondRemoved: [],
          blePairingTimedOut: ['RNode D5E7'],
          transportSaturatedCount: 0,
          slowTransportQueryCount: 0,
          suppressedCount: 0,
          lastAtMs: Date.now(),
        },
      },
    );
    const timeoutRow = rows.find(
      (r): r is RfDiagnosticRow =>
        r.kind === 'rf' && r.condition === 'reticulum/ble-pairing-timed-out',
    );
    expect(timeoutRow).toBeDefined();
    expect(timeoutRow?.causeI18n?.key).toBe(
      'diagnosticsPanel.reticulum.runtime.blePairingTimedOut',
    );
    expect(timeoutRow?.causeI18n?.params).toEqual({ name: 'RNode D5E7' });
  });

  it('adds link timeout and transport saturation rows from sidecar alerts', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        interfaceIssueAlert: {
          tcpConnectFailed: [],
          txQueueDrops: [],
          linkDeliveryTimeouts: [{ destinationHash: '5526a65d0b4d23448206fd3485b76f5b', count: 3 }],
          bleBondRemoved: [],
          blePairingTimedOut: [],
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

  it('flags announce-bus-pressure from recent WS lag with enough skipped frames', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const rows = buildReticulumDiagnosticRows(
        { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
        {
          inboundLxmf: {
            lastEventsLaggedAt: now - 60_000,
            lastEventsLaggedSkipped: 8,
            lastInboundCatchUpAt: null,
            lastInboundCatchUpCount: null,
            inboundCatchUpWatermarkTs: null,
            lastInboundRingLen: null,
          },
        },
      );
      const row = rows.find(
        (r): r is RfDiagnosticRow =>
          r.kind === 'rf' && r.condition === 'reticulum/announce-bus-pressure',
      );
      expect(row).toBeDefined();
      expect(row?.severity).toBe('warning');
      expect(row?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.announceBusPressure');
      expect(row?.reticulumRepairKind).toBe('open_interfaces');
    } finally {
      vi.useRealTimers();
    }
  });

  it('flags announce-bus-pressure from recent sidecar storm stamp', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const rows = buildReticulumDiagnosticRows(
        {
          rns_ready: true,
          lxmf_ready: true,
          interface_count: 1,
          peer_count: 5000,
          announce_ws: {
            last_window_ingress: 900,
            last_window_unique: 400,
            last_window_overflow: 0,
            last_storm_at_ms: now - 30_000,
            last_flush_at_ms: now - 30_000,
          },
        },
        {},
      );
      expect(
        rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/announce-bus-pressure'),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not flag announce-bus-pressure without lag, storm, or fresh overflow', () => {
    const now = 1_700_000_000_000;
    expect(
      shouldEmitAnnounceBusPressure(
        {
          last_window_ingress: 10,
          last_window_unique: 8,
          last_window_overflow: 0,
          last_storm_at_ms: 0,
          last_flush_at_ms: now - 1_000,
        },
        {
          lastEventsLaggedAt: now - 60_000,
          lastEventsLaggedSkipped: 3,
          lastInboundCatchUpAt: null,
          lastInboundCatchUpCount: null,
          inboundCatchUpWatermarkTs: null,
          lastInboundRingLen: null,
        },
        now,
      ),
    ).toBe(false);
    expect(
      shouldEmitAnnounceBusPressure(
        {
          last_window_overflow: 50,
          last_flush_at_ms: now - RETICULUM_ANNOUNCE_BUS_PRESSURE_TTL_MS - 1,
          last_storm_at_ms: now - RETICULUM_ANNOUNCE_BUS_PRESSURE_TTL_MS - 1,
        },
        {
          lastEventsLaggedAt: now - RETICULUM_ANNOUNCE_BUS_PRESSURE_TTL_MS - 1,
          lastEventsLaggedSkipped: 20,
          lastInboundCatchUpAt: null,
          lastInboundCatchUpCount: null,
          inboundCatchUpWatermarkTs: null,
          lastInboundRingLen: null,
        },
        now,
      ),
    ).toBe(false);
    expect(shouldEmitAnnounceBusPressure(undefined, undefined, now)).toBe(false);
    // peer_count alone must not fire
    expect(
      buildReticulumDiagnosticRows({
        rns_ready: true,
        lxmf_ready: true,
        interface_count: 1,
        peer_count: 50_000,
      }).some((r) => r.kind === 'rf' && r.condition === 'reticulum/announce-bus-pressure'),
    ).toBe(false);
  });

  it('flags announce-bus-pressure from fresh coalesce overflow', () => {
    const now = 1_700_000_000_000;
    expect(
      shouldEmitAnnounceBusPressure(
        {
          last_window_overflow: 12,
          last_flush_at_ms: now - 10_000,
          last_storm_at_ms: 0,
        },
        undefined,
        now,
      ),
    ).toBe(true);
  });

  it('flags sidecar-unhealthy when running and unhealthy past grace', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        sidecarRunning: true,
        sidecarHealthy: false,
        sidecarUnhealthySince: Date.now() - 65_000,
      },
    );
    const row = rows.find(
      (r): r is RfDiagnosticRow => r.kind === 'rf' && r.condition === 'reticulum/sidecar-unhealthy',
    );
    expect(row).toBeDefined();
    expect(row?.severity).toBe('error');
    expect(row?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.sidecarUnhealthy');
    expect(row?.reticulumRepairKind).toBe('restart_stack');
  });

  it('does not flag sidecar-unhealthy within grace or when since is missing', () => {
    expect(
      buildReticulumDiagnosticRows(
        { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
        {
          sidecarRunning: true,
          sidecarHealthy: false,
          sidecarUnhealthySince: Date.now() - 5_000,
        },
      ).some((r) => r.kind === 'rf' && r.condition === 'reticulum/sidecar-unhealthy'),
    ).toBe(false);
    expect(
      buildReticulumDiagnosticRows(
        { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
        { sidecarRunning: true, sidecarHealthy: false },
      ).some((r) => r.kind === 'rf' && r.condition === 'reticulum/sidecar-unhealthy'),
    ).toBe(false);
  });

  it('does not flag sidecar-unhealthy when healthy or not running', () => {
    expect(
      buildReticulumDiagnosticRows(
        { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
        { sidecarRunning: true, sidecarHealthy: true },
      ).some((r) => r.kind === 'rf' && r.condition === 'reticulum/sidecar-unhealthy'),
    ).toBe(false);
    expect(
      buildReticulumDiagnosticRows(
        { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
        { sidecarRunning: false, sidecarHealthy: false },
      ).some((r) => r.kind === 'rf' && r.condition === 'reticulum/sidecar-unhealthy'),
    ).toBe(false);
  });

  it('flags propagation-sync-stuck when establishing past stall window', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        propagation: {
          syncActive: true,
          syncProgress: 5,
          lastSyncError: null,
          lastAttemptAt: Date.now() - 50_000,
        },
      },
    );
    const row = rows.find(
      (r): r is RfDiagnosticRow =>
        r.kind === 'rf' && r.condition === 'reticulum/propagation-sync-stuck',
    );
    expect(row).toBeDefined();
    expect(row?.severity).toBe('warning');
    expect(row?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.propagationSyncStuck');
  });

  it('does not flag stuck when progress is past establishing', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        propagation: {
          syncActive: true,
          syncProgress: 40,
          lastSyncError: null,
          lastAttemptAt: Date.now() - 50_000,
        },
      },
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/propagation-sync-stuck'),
    ).toBe(false);
  });

  it('flags propagation-sync-failing when idle with lastSyncError', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        propagation: {
          syncActive: false,
          syncProgress: 0,
          lastSyncError: 'reticulumPropagation.syncTimedOut',
          lastAttemptAt: Date.now() - 60_000,
        },
      },
    );
    const row = rows.find(
      (r): r is RfDiagnosticRow =>
        r.kind === 'rf' && r.condition === 'reticulum/propagation-sync-failing',
    );
    expect(row).toBeDefined();
    expect(row?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.propagationSyncFailing');
  });

  it('ignores user-cancelled propagation sync as failing', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        propagation: {
          syncActive: false,
          syncProgress: 0,
          lastSyncError: 'reticulumPropagation.syncCancelled',
          lastAttemptAt: Date.now() - 1_000,
        },
      },
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/propagation-sync-failing'),
    ).toBe(false);
  });

  it('does not flag failing when last attempt is older than TTL', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        propagation: {
          syncActive: false,
          syncProgress: 0,
          lastSyncError: 'reticulumPropagation.syncTimedOut',
          lastAttemptAt: Date.now() - 2 * 60 * 60 * 1000,
        },
      },
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/propagation-sync-failing'),
    ).toBe(false);
  });

  it('does not flag stuck at exact sub-stall boundary or without attemptAt', () => {
    vi.useFakeTimers();
    try {
      const now = 1_700_000_000_000;
      vi.setSystemTime(now);
      expect(
        buildReticulumDiagnosticRows(
          { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
          {
            propagation: {
              syncActive: true,
              syncProgress: 5,
              lastSyncError: null,
              lastAttemptAt: now - 44_999,
            },
          },
        ).some((r) => r.kind === 'rf' && r.condition === 'reticulum/propagation-sync-stuck'),
      ).toBe(false);
      expect(
        buildReticulumDiagnosticRows(
          { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
          {
            propagation: {
              syncActive: true,
              syncProgress: 5,
              lastSyncError: null,
              lastAttemptAt: null,
            },
          },
        ).some((r) => r.kind === 'rf' && r.condition === 'reticulum/propagation-sync-stuck'),
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flags too-many-default-backbones when more than 3 default presets are enabled', () => {
    const hubs = [
      {
        id: '1',
        name: 'Dublin',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'dublin.connect.reticulum.network',
        port: 4965,
        mode: 'boundary',
      },
      {
        id: '2',
        name: 'BTB',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'reticulum.betweentheborders.com',
        port: 4242,
        mode: 'boundary',
      },
      {
        id: '3',
        name: 'RMAP',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'rmap.world',
        port: 4242,
        mode: 'boundary',
      },
      {
        id: '4',
        name: 'Simply',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'rns.simplyequipped.com',
        port: 4242,
        mode: 'boundary',
      },
    ];
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 4, peer_count: 10 },
      { interfaces: hubs },
    );
    const row = rows.find(
      (r): r is RfDiagnosticRow =>
        r.kind === 'rf' && r.condition === 'reticulum/too-many-default-backbones',
    );
    expect(row).toBeDefined();
    expect(row?.severity).toBe('warning');
    expect(row?.causeI18n?.params?.count).toBe('4');
    expect(row?.reticulumRepairKind).toBe('open_interfaces');
  });

  it('does not flag too-many-default-backbones at 3 or fewer', () => {
    const hubs = [
      {
        id: '1',
        name: 'Dublin',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'dublin.connect.reticulum.network',
        port: 4965,
      },
      {
        id: '2',
        name: 'BTB',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'reticulum.betweentheborders.com',
        port: 4242,
      },
      {
        id: '3',
        name: 'RMAP',
        type: 'tcp',
        enabled: true,
        status: 'up',
        host: 'rmap.world',
        port: 4242,
      },
    ];
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 3, peer_count: 10 },
      { interfaces: hubs },
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/too-many-default-backbones'),
    ).toBe(false);
  });

  it('flags enabled decommissioned hub', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        interfaces: [
          {
            id: 'ams',
            name: 'Amsterdam',
            type: 'tcp',
            enabled: true,
            status: 'down',
            host: 'amsterdam.connect.reticulum.network',
            port: 4965,
          },
        ],
      },
    );
    const row = rows.find(
      (r): r is RfDiagnosticRow =>
        r.kind === 'rf' && r.condition === 'reticulum/decommissioned-hub-enabled',
    );
    expect(row).toBeDefined();
    expect(row?.reticulumInterfaceId).toBe('ams');
    expect(row?.reticulumRepairKind).toBe('disable');
    expect(row?.causeI18n?.params?.name).toBe('Amsterdam');
  });

  it('does not flag disabled decommissioned hub', () => {
    const rows = buildReticulumDiagnosticRows(
      { rns_ready: true, lxmf_ready: true, interface_count: 1, peer_count: 1 },
      {
        interfaces: [
          {
            id: 'ams',
            name: 'Amsterdam',
            type: 'tcp',
            enabled: false,
            status: 'down',
            host: 'amsterdam.connect.reticulum.network',
            port: 4965,
          },
        ],
      },
    );
    expect(
      rows.some((r) => r.kind === 'rf' && r.condition === 'reticulum/decommissioned-hub-enabled'),
    ).toBe(false);
  });

  it('attributes announce-bus-pressure with hot interface and boundary hubs', () => {
    const now = 1_700_000_000_000;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      const rows = buildReticulumDiagnosticRows(
        { rns_ready: true, lxmf_ready: true, interface_count: 2, peer_count: 100 },
        {
          inboundLxmf: {
            lastEventsLaggedAt: now - 10_000,
            lastEventsLaggedSkipped: 12,
            lastInboundCatchUpAt: null,
            lastInboundCatchUpCount: null,
            inboundCatchUpWatermarkTs: null,
            lastInboundRingLen: null,
          },
          hotPeerInterface: 'RNS Dublin Mainnet',
          interfaces: [
            {
              id: '1',
              name: 'RNS Dublin Mainnet',
              type: 'tcp',
              enabled: true,
              status: 'up',
              host: 'dublin.connect.reticulum.network',
              port: 4965,
              mode: 'boundary',
            },
            {
              id: '2',
              name: 'Local RNode',
              type: 'rnode',
              enabled: true,
              status: 'up',
              mode: 'access_point',
            },
          ],
          interfaceIssueAlert: {
            lastAtMs: now,
            tcpConnectFailed: [],
            txQueueDrops: [{ name: 'RNS Dublin Mainnet', dropCount: 3 }],
            bleBondRemoved: [],
            blePairingTimedOut: [],
            linkDeliveryTimeouts: [],
            transportSaturatedCount: 0,
            slowTransportQueryCount: 0,
            suppressedCount: 0,
          },
        },
      );
      const row = rows.find(
        (r): r is RfDiagnosticRow =>
          r.kind === 'rf' && r.condition === 'reticulum/announce-bus-pressure',
      );
      expect(row?.causeI18n?.key).toBe('diagnosticsPanel.reticulum.runtime.announceBusPressureHot');
      expect(row?.causeI18n?.params?.hotInterface).toBe('RNS Dublin Mainnet');
      expect(row?.causeI18n?.params?.boundaryHubs).toBe('RNS Dublin Mainnet');
      expect(row?.causeI18n?.params?.txSaturatedIfaces).toBe('RNS Dublin Mainnet');
    } finally {
      vi.useRealTimers();
    }
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
