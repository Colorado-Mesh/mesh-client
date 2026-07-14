import type { DiagnosticRow } from '@/renderer/lib/types';
import { rfRowId } from '@/renderer/lib/types';

export type ReticulumConfigAuditSeverity = 'error' | 'warning' | 'info';

export type ReticulumConfigRepairKind =
  | 'repair_config'
  | 'disable'
  | 'apply_preset'
  | 'edit'
  | 'restart_stack'
  | 'add_auto'
  | 'disable_share_instance';

export interface ReticulumConfigAuditIssue {
  kind: string;
  severity: ReticulumConfigAuditSeverity;
  interface_id?: string | null;
  interface_name?: string | null;
  message: string;
  repair_kind?: string | null;
}

export interface ReticulumConfigAuditResponse {
  issues?: ReticulumConfigAuditIssue[];
  ok?: boolean;
  error?: string;
}

export interface ReticulumConfigRepairResponse {
  ok?: boolean;
  repaired?: string[];
  restart_required?: boolean;
  error?: string;
}

export async function fetchReticulumConfigAudit(): Promise<ReticulumConfigAuditIssue[]> {
  const body = (await window.electronAPI.reticulum.proxyGet(
    '/api/v1/config/audit',
  )) as ReticulumConfigAuditResponse;
  if (body.error) {
    throw new Error(body.error);
  }
  return body.issues ?? [];
}

export async function repairReticulumConfig(
  repairKinds: ReticulumConfigRepairKind[] = [],
): Promise<ReticulumConfigRepairResponse> {
  return (await window.electronAPI.reticulum.proxyPost('/api/v1/config/repair', {
    repair_kinds: repairKinds,
  })) as ReticulumConfigRepairResponse;
}

function auditI18nKey(kind: string): string {
  return `diagnosticsPanel.reticulum.audit.${kind}`;
}

/** Expected runtime state — not actionable; Connection tab shows a Runtime badge instead. */
export const RETICULUM_AUDIT_KINDS_EXCLUDED_FROM_DIAGNOSTICS = new Set(['runtime_only_interface']);

export function auditIssuesToDiagnosticRows(
  issues: ReticulumConfigAuditIssue[],
  selfNodeId: number,
): DiagnosticRow[] {
  const now = Date.now();
  return issues
    .filter((issue) => !RETICULUM_AUDIT_KINDS_EXCLUDED_FROM_DIAGNOSTICS.has(issue.kind))
    .map((issue) => {
      const ifaceId = issue.interface_id ?? undefined;
      const slug = ifaceId ? `${issue.kind}/${ifaceId}` : issue.kind;
      const repairKind = issue.repair_kind as ReticulumConfigRepairKind | undefined;
      return {
        kind: 'rf' as const,
        id: rfRowId(selfNodeId, `reticulum/audit/${slug}`),
        nodeId: selfNodeId,
        condition: `reticulum/audit/${issue.kind}`,
        cause: issue.message,
        severity: issue.severity,
        detectedAt: now,
        causeI18n: {
          key: auditI18nKey(issue.kind),
          params: {
            name: issue.interface_name ?? '',
            message: issue.message,
          },
        },
        reticulumInterfaceId: ifaceId,
        reticulumRepairKind: repairKind ?? undefined,
      };
    });
}
