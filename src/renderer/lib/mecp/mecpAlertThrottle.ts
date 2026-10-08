import { MS_PER_MINUTE } from '@/shared/timeConstants';

/** Alerts per sender allowed inside {@link MECP_ALERT_THROTTLE_WINDOW_MS} before tones go quiet. */
export const MECP_ALERT_THROTTLE_MAX = 3;
export const MECP_ALERT_THROTTLE_WINDOW_MS = 10 * MS_PER_MINUTE;
/** Distinct alerting senders inside {@link MECP_ALERT_FLOOD_WINDOW_MS} that count as a flood. */
export const MECP_ALERT_FLOOD_MAX_SENDERS = 5;
export const MECP_ALERT_FLOOD_WINDOW_MS = MS_PER_MINUTE;
/** Lazy cleanup threshold for the per-sender map. */
const MAX_TRACKED_SENDERS = 1000;

export interface MecpThrottleDecision {
  /** Play the siren/tone and show the incoming toast. */
  alert: boolean;
  /** First suppression this window: tell the operator once (`sender` offers Block). */
  notify: 'sender' | 'flood' | null;
}

interface SenderWindow {
  alerts: number[];
  notifiedAt: number | null;
}

const senders = new Map<string, SenderWindow>();
let recentAlerts: { key: string; at: number }[] = [];
let floodNotifiedAt: number | null = null;

/** @internal Test helper. */
export function resetMecpAlertThrottleForTests(): void {
  senders.clear();
  recentAlerts = [];
  floodNotifiedAt = null;
}

function pruneSenders(now: number): void {
  if (senders.size <= MAX_TRACKED_SENDERS) return;
  for (const [key, w] of senders) {
    if (w.alerts.every((at) => now - at > MECP_ALERT_THROTTLE_WINDOW_MS)) senders.delete(key);
  }
}

function senderAlertsInWindow(key: string, now: number): number[] {
  return (senders.get(key)?.alerts ?? []).filter((at) => now - at <= MECP_ALERT_THROTTLE_WINDOW_MS);
}

function floodActive(key: string, now: number): boolean {
  const others = new Set(
    recentAlerts
      .filter((a) => now - a.at <= MECP_ALERT_FLOOD_WINDOW_MS && a.key !== key)
      .map((a) => a.key),
  );
  return others.size >= MECP_ALERT_FLOOD_MAX_SENDERS;
}

/**
 * Read-only: would a new alert from `key` be suppressed right now? Used by ChatPanel, which shares
 * the dedupe key with the watcher but must not count the same message twice.
 */
export function isMecpAlertThrottled(key: string, now = Date.now()): boolean {
  return senderAlertsInWindow(key, now).length >= MECP_ALERT_THROTTLE_MAX || floodActive(key, now);
}

/**
 * Count one live inbound MECP alert from `key` (`${protocol}:${senderId}`) and decide whether it
 * may sound. Never decides whether the incident is recorded — callers always record it.
 */
export function recordMecpAlert(key: string, now = Date.now()): MecpThrottleDecision {
  const inWindow = senderAlertsInWindow(key, now);
  const prev = senders.get(key);
  const senderThrottled = inWindow.length >= MECP_ALERT_THROTTLE_MAX;
  const flooded = !senderThrottled && floodActive(key, now);

  recentAlerts = recentAlerts.filter((a) => now - a.at <= MECP_ALERT_FLOOD_WINDOW_MS);
  recentAlerts.push({ key, at: now });

  let notifiedAt = prev?.notifiedAt ?? null;
  let notify: MecpThrottleDecision['notify'] = null;
  if (senderThrottled) {
    if (notifiedAt == null || now - notifiedAt > MECP_ALERT_THROTTLE_WINDOW_MS) {
      notify = 'sender';
      notifiedAt = now;
    }
  } else if (flooded) {
    if (floodNotifiedAt == null || now - floodNotifiedAt > MECP_ALERT_FLOOD_WINDOW_MS) {
      notify = 'flood';
      floodNotifiedAt = now;
    }
  }

  senders.set(key, { alerts: [...inWindow, now], notifiedAt });
  pruneSenders(now);
  return { alert: !senderThrottled && !flooded, notify };
}
