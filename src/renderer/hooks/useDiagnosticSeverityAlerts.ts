import { useEffect, useRef } from 'react';

import type { MeshProtocol } from '@/shared/meshProtocol';
import { MS_PER_MINUTE } from '@/shared/timeConstants';

import type { OperationalAlertSettings } from '../lib/appSettingsStorage';
import { playMessageNotification } from '../lib/chatNotifications';
import { fireNotification } from '../lib/desktopNotification';
import { filterDiagnosticRowsForProtocol } from '../lib/diagnostics/diagnosticRows';
import i18n from '../lib/i18n';
import { useDiagnosticsStore } from '../stores/diagnosticsStore';

/** Cooldown before re-alerting the same diagnostic row id after it reappears. */
export const DIAGNOSTIC_ALERT_COOLDOWN_MS = 5 * MS_PER_MINUTE;

export interface UseDiagnosticSeverityAlertsArgs {
  protocol: MeshProtocol;
  settings: OperationalAlertSettings;
}

/**
 * Opt-in desktop + sound alerts when new error-severity diagnostic rows appear
 * for the active protocol (default off via `notifyOnDiagnosticErrors`).
 */
export function useDiagnosticSeverityAlerts({
  protocol,
  settings,
}: UseDiagnosticSeverityAlertsArgs): void {
  const diagnosticRows = useDiagnosticsStore((s) => s.diagnosticRows);
  const firedRef = useRef<Map<string, number>>(new Map());
  const primedRef = useRef(false);

  useEffect(() => {
    if (!settings.notifyOnDiagnosticErrors) {
      firedRef.current.clear();
      primedRef.current = false;
      return;
    }

    const rows = filterDiagnosticRowsForProtocol(diagnosticRows, protocol).filter(
      (r) => r.severity === 'error',
    );
    const now = Date.now();
    const fired = firedRef.current;

    // Prune expired cooldowns (keep entries after a row clears so reappearances stay quiet).
    for (const [id, at] of fired) {
      if (now - at >= DIAGNOSTIC_ALERT_COOLDOWN_MS) fired.delete(id);
    }

    // On first enable / first mount with the setting on, seed without notifying
    // so a restart does not replay every persisted error row.
    if (!primedRef.current) {
      for (const row of rows) fired.set(row.id, now);
      primedRef.current = true;
      return;
    }

    for (const row of rows) {
      const last = fired.get(row.id);
      if (last != null && now - last < DIAGNOSTIC_ALERT_COOLDOWN_MS) continue;
      fired.set(row.id, now);
      const title = i18n.t('diagnosticAlerts.title');
      const description =
        row.kind === 'routing' ? row.description : row.condition || row.cause || row.id;
      const body = i18n.t('diagnosticAlerts.body', { description });
      fireNotification(title, body);
      playMessageNotification('diagnosticError');
    }
  }, [diagnosticRows, protocol, settings.notifyOnDiagnosticErrors]);
}
