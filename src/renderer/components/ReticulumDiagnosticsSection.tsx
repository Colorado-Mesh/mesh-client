import { Info, TriangleAlert } from 'lucide-react-motion';
import React, { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import {
  DIAGNOSTICS_CATEGORY_STYLES,
  DIAGNOSTICS_SEVERITY_HEADER,
  DIAGNOSTICS_SEVERITY_TEXT,
  reticulumMeshHealthBand,
} from '@/renderer/lib/diagnostics/diagnosticsPanelStyles';
import { isReticulumDiagnosticRow } from '@/renderer/lib/diagnostics/ReticulumDiagnosticEngine';
import { translateReticulumDiagnosticCause } from '@/renderer/lib/diagnostics/reticulumDiagnosticLabels';
import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import { restartReticulumStack } from '@/renderer/lib/reticulum/restartReticulumStack';
import {
  repairReticulumConfig,
  type ReticulumConfigRepairKind,
} from '@/renderer/lib/reticulum/reticulumConfigAudit';
import type { DiagnosticRow, RfDiagnosticRow } from '@/renderer/lib/types';
import { useReticulumUiStore } from '@/renderer/stores/reticulumUiStore';

export interface ReticulumDiagnosticsSectionProps {
  rows: DiagnosticRow[];
  onNavigateToConnection?: () => void;
  onRefreshDiagnostics?: () => void;
}

function SeverityIcon({ severity }: { severity: string }) {
  const trigger = useIconTrigger();
  if (severity === 'info') {
    return <Info aria-hidden className="inline h-4 w-4" trigger={trigger} size={16} />;
  }
  return <TriangleAlert aria-hidden className="inline h-4 w-4" trigger={trigger} size={16} />;
}

function severityHeaderKey(severity: 'error' | 'warning' | 'info', count: number): string {
  if (severity === 'info') {
    return count === 1
      ? 'diagnosticsPanel.severityNotes_one'
      : 'diagnosticsPanel.severityNotes_other';
  }
  if (severity === 'warning') {
    return count === 1
      ? 'diagnosticsPanel.severityWarnings_one'
      : 'diagnosticsPanel.severityWarnings_other';
  }
  return count === 1
    ? 'diagnosticsPanel.severityErrors_one'
    : 'diagnosticsPanel.severityErrors_other';
}

function remedyCategoryForRow(row: RfDiagnosticRow): keyof typeof DIAGNOSTICS_CATEGORY_STYLES {
  if (row.reticulumRepairKind === 'repair_config' || row.reticulumRepairKind === 'add_auto') {
    return 'Configuration';
  }
  if (
    row.reticulumRepairKind === 'restart_stack' ||
    row.reticulumRepairKind === 'disable_share_instance'
  ) {
    return 'Software';
  }
  if (row.reticulumRepairKind === 'apply_preset') {
    return 'Hardware';
  }
  return 'Configuration';
}

export function ReticulumDiagnosticsSection({
  rows,
  onNavigateToConnection,
  onRefreshDiagnostics,
}: ReticulumDiagnosticsSectionProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const requestInterfaceEdit = useReticulumUiStore((s) => s.requestInterfaceEdit);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reticulumRows = useMemo(
    () => rows.filter((r): r is RfDiagnosticRow => r.kind === 'rf' && isReticulumDiagnosticRow(r)),
    [rows],
  );

  const errorCount = reticulumRows.filter((r) => r.severity === 'error').length;
  const warningCount = reticulumRows.filter((r) => r.severity === 'warning').length;
  const meshHealth = reticulumMeshHealthBand(errorCount, warningCount);

  const runRepair = useCallback(
    async (kinds: ReticulumConfigRepairKind[], rowKey: string) => {
      setBusyKey(rowKey);
      try {
        const res = await repairReticulumConfig(kinds);
        if (!res.ok) {
          addToast(res.error ?? t('diagnosticsPanel.reticulum.repairFailed'), 'error');
          return;
        }
        if (!res.repaired?.length) {
          addToast(t('diagnosticsPanel.reticulum.repairNoChanges'), 'warning');
          onRefreshDiagnostics?.();
          return;
        }
        addToast(t('diagnosticsPanel.reticulum.repairSuccess'), 'success');
        if (res.restart_required) {
          await restartReticulumStack({
            onRefresh: () => Promise.resolve(onRefreshDiagnostics?.()),
            logTag: 'ReticulumDiagnosticsSection',
          });
          return;
        }
        onRefreshDiagnostics?.();
      } catch (e) {
        addToast(t('diagnosticsPanel.reticulum.repairFailed'), 'error');
        console.debug('[ReticulumDiagnosticsSection] repair', e);
      } finally {
        setBusyKey(null);
      }
    },
    [onRefreshDiagnostics, t, addToast],
  );

  const runDisable = useCallback(
    async (interfaceId: string, rowKey: string) => {
      setBusyKey(rowKey);
      try {
        await window.electronAPI.reticulum.proxyPost(
          `/api/v1/interfaces/${interfaceId}/disable`,
          {},
        );
        addToast(t('diagnosticsPanel.reticulum.disableSuccess'), 'success');
        onRefreshDiagnostics?.();
      } catch (e) {
        addToast(t('diagnosticsPanel.reticulum.disableFailed'), 'error');
        console.debug('[ReticulumDiagnosticsSection] disable', e);
      } finally {
        setBusyKey(null);
      }
    },
    [onRefreshDiagnostics, t, addToast],
  );

  const runAction = useCallback(
    async (row: RfDiagnosticRow) => {
      const kind = row.reticulumRepairKind;
      if (!kind) return;
      if (kind === 'edit') {
        if (row.reticulumInterfaceId) {
          requestInterfaceEdit(row.reticulumInterfaceId);
        }
        onNavigateToConnection?.();
        return;
      }
      if (kind === 'restart_stack') {
        setBusyKey(row.id);
        try {
          await restartReticulumStack({
            onRefresh: () => Promise.resolve(onRefreshDiagnostics?.()),
            logTag: 'ReticulumDiagnosticsSection',
          });
        } finally {
          setBusyKey(null);
        }
        return;
      }
      if (kind === 'disable' && row.reticulumInterfaceId) {
        await runDisable(row.reticulumInterfaceId, row.id);
        return;
      }
      if (kind === 'repair_config') {
        await runRepair(['repair_config'], row.id);
        return;
      }
      if (kind === 'add_auto') {
        await runRepair(['add_auto'], row.id);
        return;
      }
      if (kind === 'disable_share_instance') {
        await runRepair(['disable_share_instance'], row.id);
        return;
      }
      if (kind === 'apply_preset') {
        await runRepair(['apply_preset'], row.id);
      }
    },
    [onNavigateToConnection, onRefreshDiagnostics, requestInterfaceEdit, runDisable, runRepair],
  );

  if (reticulumRows.length === 0) {
    return (
      <div className={`rounded-xl border p-4 ${meshHealth.bg}`}>
        <p className={`text-sm font-semibold ${meshHealth.textColor}`}>{t(meshHealth.labelKey)}</p>
        <p className="text-muted mt-1 text-xs">{t('diagnosticsPanel.reticulum.noIssues')}</p>
      </div>
    );
  }

  const grouped = (['error', 'warning', 'info'] as const).map((severity) => ({
    severity,
    rows: reticulumRows.filter((r) => r.severity === severity),
  }));

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-4 ${meshHealth.bg}`}>
        <p className={`text-sm font-semibold ${meshHealth.textColor}`}>{t(meshHealth.labelKey)}</p>
        <p className="text-muted mt-1 text-xs">
          {t('diagnosticsPanel.reticulum.summary', {
            errors: errorCount,
            warnings: warningCount,
          })}
        </p>
      </div>

      <div className="overflow-auto rounded-lg border border-gray-700">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="bg-deep-black text-muted sticky top-0">
            <tr>
              <th className="px-4 py-2 font-medium">
                {t('diagnosticsPanel.reticulum.colInterface')}
              </th>
              <th className="px-4 py-2 font-medium">{t('diagnosticsPanel.reticulum.colIssue')}</th>
              <th className="px-4 py-2 font-medium">{t('diagnosticsPanel.reticulum.colFix')}</th>
              <th className="px-4 py-2 font-medium">{t('diagnosticsPanel.reticulum.colAction')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {grouped.map(({ severity, rows: groupRows }) =>
              groupRows.length > 0 ? (
                <React.Fragment key={`group-${severity}`}>
                  <tr className={DIAGNOSTICS_SEVERITY_HEADER[severity]}>
                    <td colSpan={4} className="px-4 py-1.5 text-xs font-semibold uppercase">
                      <SeverityIcon severity={severity} />{' '}
                      {t(severityHeaderKey(severity, groupRows.length), {
                        count: groupRows.length,
                      })}
                    </td>
                  </tr>
                  {groupRows.map((row) => {
                    const category = remedyCategoryForRow(row);
                    const repairKind = row.reticulumRepairKind;
                    return (
                      <tr key={row.id} className="hover:bg-secondary-dark/50">
                        <td className="px-4 py-2.5 text-gray-200">
                          {row.reticulumInterfaceId
                            ? (/"([^"]+)"/.exec(row.cause)?.[1] ?? t('common.emDash'))
                            : t('diagnosticsPanel.reticulum.stackScope')}
                        </td>
                        <td
                          className={`px-4 py-2.5 text-xs ${DIAGNOSTICS_SEVERITY_TEXT[severity]}`}
                        >
                          {row.causeI18n ? translateReticulumDiagnosticCause(t, row) : row.cause}
                        </td>
                        <td className="px-4 py-2.5">
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-[10px] font-medium whitespace-nowrap ${DIAGNOSTICS_CATEGORY_STYLES[category]}`}
                          >
                            {t(`diagnosticsPanel.reticulum.remedy.${category.toLowerCase()}`)}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {repairKind ? (
                            <button
                              type="button"
                              disabled={busyKey === row.id}
                              onClick={() => {
                                void runAction(row);
                              }}
                              className="bg-secondary-dark rounded px-2 py-1 text-xs text-gray-300 hover:bg-gray-600 disabled:opacity-40"
                              aria-label={t(`diagnosticsPanel.reticulum.action.${repairKind}`)}
                            >
                              {t(`diagnosticsPanel.reticulum.action.${repairKind}`)}
                            </button>
                          ) : (
                            <span className="text-muted text-xs">{t('common.emDash')}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </React.Fragment>
              ) : null,
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
