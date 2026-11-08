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
  const protocolRef = useRef<MeshProtocol | null>(null);

  useEffect(() => {
    if (!settings.notifyOnDiagnosticErrors) {
      firedRef.current.clear();
      primedRef.current = false;
      protocolRef.current = null;
      return;
    }

    const rows = filterDiagnosticRowsForProtocol(diagnosticRows, protocol).filter(
      (r) => r.severity === 'error',
    );
    const now = Date.now();
    const fired = firedRef.current;
    const present = new Set(rows.map((row) => row.id));

    // Drop a cooldown only after the row has been gone for the full window.
    // A standing error stays suppressed for as long as it is present.
    for (const [id, at] of fired) {
      if (present.has(id)) continue;
      if (now - at >= DIAGNOSTIC_ALERT_COOLDOWN_MS) fired.delete(id);
    }

    // First enable, and each protocol change, seed the rows already on screen
    // (including a pre-clear snapshot) so they are not announced as new.
    if (!primedRef.current || protocolRef.current !== protocol) {
      for (const row of rows) fired.set(row.id, now);
      primedRef.current = true;
      protocolRef.current = protocol;
      return;
    }

    for (const row of rows) {
      if (fired.has(row.id)) {
        fired.set(row.id, now);
        continue;
      }
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
