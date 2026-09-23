import { pushAppToast } from '@/renderer/components/Toast';
import { CHAT_NOTIF_MUTED_STORAGE_KEY } from '@/renderer/lib/chatInactiveNotifications';
import {
  playMecpEasAttention,
  playMecpSiren,
  playMessageNotification,
} from '@/renderer/lib/chatNotifications';
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
  /**
   * Optional idempotency key so ChatPanel + useMecpAlertWatcher can both call
   * without double siren/toast for the same inbound message.
   */
  dedupeKey?: string;
}

const recentAlertKeys = new Set<string>();
const DEDUPE_TTL_MS = 60_000;

/** @internal Test helper. */
export function resetMecpAlertDedupeForTests(): void {
  recentAlertKeys.clear();
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
 * Always audible when focused on the receiving chat (callers must not gate on focus).
 */
export function triggerMecpAlert(ctx: MecpAlertContext): void {
  if (ctx.isDrill) return;

  const dedupeKey = ctx.dedupeKey;
  if (dedupeKey) {
    if (recentAlertKeys.has(dedupeKey)) return;
    recentAlertKeys.add(dedupeKey);
    globalThis.setTimeout(() => {
      recentAlertKeys.delete(dedupeKey);
    }, DEDUPE_TTL_MS);
  }

  const viewMuted = ctx.mutedViews.has(ctx.viewKey);
  const globalMuted = isGloballyMuted();
  const highSeverity = ctx.severity <= 1;
  if (!highSeverity && (globalMuted || viewMuted)) return;

  if (ctx.severity === 0) {
    playMecpSiren();
  } else if (ctx.severity === 1) {
    playMecpEasAttention();
  } else {
    playMessageNotification(ctx.severity === 2 ? 'mecpSafety' : 'mecp');
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
