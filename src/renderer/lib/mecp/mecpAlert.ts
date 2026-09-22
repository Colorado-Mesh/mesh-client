import { pushAppToast } from '@/renderer/components/Toast';
import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import { playMecpSiren, playMessageNotification } from '@/renderer/lib/chatNotifications';
import i18n from '@/renderer/lib/i18n';
import type { MecpParsed } from '@/renderer/lib/mecp/mecpMessages';

export interface MecpAlertContext {
  severity: NonNullable<MecpParsed['severity']>;
  isDrill: boolean;
  senderLabel: string;
  viewKey: string;
  mutedViews: ReadonlySet<string>;
  /** When document.hidden, also fire a silent OS Notification. */
  notifyHiddenWindow?: boolean;
}

function isGloballyMuted(): boolean {
  try {
    return localStorage.getItem(CHAT_NOTIF_MUTED_STORAGE_KEY) === '1';
  } catch {
    // catch-no-log-ok localStorage may be unavailable in tests
    return false;
  }
}

/**
 * Play sound + emergency toast for an inbound MECP message.
 * Severity 0–1 ignore mutes; 2–3 respect global + per-view mutes. Drills never alert.
 */
export function triggerMecpAlert(ctx: MecpAlertContext): void {
  if (ctx.isDrill) return;

  const viewMuted = ctx.mutedViews.has(ctx.viewKey);
  const globalMuted = isGloballyMuted();
  const highSeverity = ctx.severity <= 1;
  if (!highSeverity && (globalMuted || viewMuted)) return;

  if (highSeverity) {
    playMecpSiren();
  } else {
    playMessageNotification('mecp');
  }

  const severityLabel = i18n.t(
    ctx.severity === 0
      ? 'mecp.severity.mayday'
      : ctx.severity === 1
        ? 'mecp.severity.urgent'
        : ctx.severity === 2
          ? 'mecp.severity.safety'
          : 'mecp.severity.routine',
  );
  pushAppToast(
    i18n.t('mecp.incomingToast', { severity: severityLabel, sender: ctx.senderLabel }),
    'emergency',
    10_000,
  );

  if (ctx.notifyHiddenWindow && typeof document !== 'undefined' && document.hidden) {
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        // Visual only — sound owned by Web Audio above
        new Notification(i18n.t('mecp.notificationTitle'), {
          body: i18n.t('mecp.incomingToast', {
            severity: severityLabel,
            sender: ctx.senderLabel,
          }),
          silent: true,
        });
      }
    } catch {
      // catch-no-log-ok Notification may be blocked
    }
  }
}
