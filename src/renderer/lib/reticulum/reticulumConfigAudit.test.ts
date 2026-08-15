// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { RfDiagnosticRow } from '@/renderer/lib/types';
import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

import {
  auditIssuesToDiagnosticRows,
  fetchReticulumConfigAudit,
  repairReticulumConfig,
} from './reticulumConfigAudit';

describe('reticulumConfigAudit', () => {
  beforeEach(() => {
    window.electronAPI = createElectronAPIMock();
  });

  it('fetchReticulumConfigAudit returns issues from proxy', async () => {
    window.electronAPI.reticulum.proxyGet = vi.fn().mockResolvedValue({
      issues: [
        {
          kind: 'ghost_interface',
          severity: 'error',
          interface_id: 'tcp-dublin',
          interface_name: 'Dublin',
          message: 'ghost',
          repair_kind: 'repair_config',
        },
      ],
    });
    const issues = await fetchReticulumConfigAudit();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe('ghost_interface');
  });

  it('repairReticulumConfig posts repair kinds', async () => {
    window.electronAPI.reticulum.proxyPost = vi.fn().mockResolvedValue({
      ok: true,
      repaired: ['tcp:Dublin'],
      restart_required: true,
    });
    const res = await repairReticulumConfig(['repair_config']);
    expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith('/api/v1/config/repair', {
      repair_kinds: ['repair_config'],
    });
    expect(res.restart_required).toBe(true);
  });

  it('auditIssuesToDiagnosticRows maps repair metadata', () => {
    const rows = auditIssuesToDiagnosticRows(
      [
        {
          kind: 'tcp_unreachable',
          severity: 'warning',
          interface_id: 'hub-1',
          interface_name: 'Hub',
          message: 'unreachable',
          repair_kind: 'disable',
        },
      ],
      42,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as RfDiagnosticRow;
    expect(row.kind).toBe('rf');
    expect(row.nodeId).toBe(42);
    expect(row.condition).toBe('reticulum/audit/tcp_unreachable');
    expect(row.reticulumInterfaceId).toBe('hub-1');
    expect(row.reticulumRepairKind).toBe('disable');
    expect(row.causeI18n?.key).toBe('diagnosticsPanel.reticulum.audit.tcp_unreachable');
  });

  it('auditIssuesToDiagnosticRows excludes expected runtime-only interface notes', () => {
    const rows = auditIssuesToDiagnosticRows(
      [
        {
          kind: 'runtime_only_interface',
          severity: 'info',
          interface_id: 'shared-instance',
          interface_name: 'SharedInstanceServer',
          message: 'Runtime shared-instance server (not in config)',
        },
        {
          kind: 'missing_shared_instance',
          severity: 'warning',
          interface_name: 'SharedInstanceServer',
          message: 'share_instance is on but SharedInstanceServer is not up',
          repair_kind: 'restart_stack',
        },
      ],
      1,
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as RfDiagnosticRow;
    expect(row.condition).toBe('reticulum/audit/missing_shared_instance');
  });

  it.each([
    'rmap_missing_coordinates',
    'rmap_no_tcp_hub',
    'rmap_transport_disabled',
    'rmap_i2p_not_connectable',
    'rmap_mode_autocorrect',
  ] as const)('auditIssuesToDiagnosticRows maps %s i18n key', (kind) => {
    const rows = auditIssuesToDiagnosticRows(
      [
        {
          kind,
          severity: 'warning',
          interface_id: 'iface-1',
          interface_name: 'Test',
          message: 'msg',
          repair_kind: 'edit',
        },
      ],
      1,
    );
    const row = rows[0] as RfDiagnosticRow;
    expect(row.causeI18n?.key).toBe(`diagnosticsPanel.reticulum.audit.${kind}`);
  });
});
