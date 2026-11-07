/**
 * Scheduled-broadcast scheduler (renderer, module singleton).
 *
 * - One earliest-due timer (clamped to `MAX_TIMER_DELAY_MS`) plus a 60 s safety interval that
 *   covers wall-clock jumps, DST and throttled timers.
 * - A single `running` flag serializes every fire and every Send now, so a same-minute pile-up
 *   of slots is delivered one after another under one run.
 * - Missed occurrences are never replayed: on start, power resume and master-switch enable,
 *   stale `nextDueAt` values are advanced past now and recorded as `missed`.
 * - Persistence goes through the durable IPC (`claimDue` is the atomic nextDueAt hand-off).
 *
 * Logs carry slot, outcome and text length only — never the message text.
 */
import type {
  ScheduledBroadcastLastResult,
  ScheduledBroadcastRow,
} from '@/shared/scheduledBroadcastTypes';

import { useScheduledBroadcastsStore } from '../../stores/scheduledBroadcastsStore';
import { getAppSettingsRaw } from '../appSettingsStorage';
import { errLikeToLogString } from '../errLikeToLogString';
import { parseStoredJson } from '../parseStoredJson';
import { MS_PER_MINUTE } from '../timeConstants';
import { MAX_TIMER_DELAY_MS, SCHEDULED_BROADCASTS_ENABLED_SETTING } from './constants';
import { type DeliverResult, deliverScheduledBroadcast } from './deliver';
import { getScheduledBroadcastDeliveryAdapters } from './deliveryAdapters';
import { advancePastDue, computeNextDue, type ScheduledBroadcastRule } from './recurrence';

/** Safety re-check cadence while armed. */
export const SCHEDULER_SAFETY_INTERVAL_MS = MS_PER_MINUTE;

type RuntimePatch = Pick<ScheduledBroadcastRow, 'nextDueAt' | 'lastResult' | 'lastAttemptAt'>;

export interface SchedulerDeps {
  now: () => number;
  /** Master switch (App setting). Off → nothing is armed or fired. */
  isEnabled: () => boolean;
  getSlots: () => ScheduledBroadcastRow[];
  claimDue: (
    slot: number,
    expectedNextDueAt: number,
    nextDueAt: number,
    claimedAt: number,
  ) => Promise<{ claimed: boolean }>;
  /** Persist a first/normalized `nextDueAt` when the row has none to claim against. */
  saveNextDueAt: (slot: number, nextDueAt: number | null) => Promise<void>;
  setResult: (
    slot: number,
    lastAttemptAt: number,
    lastResult: ScheduledBroadcastLastResult,
  ) => Promise<void>;
  applyRuntimeState: (slot: number, patch: RuntimePatch) => void;
  deliver: (slot: ScheduledBroadcastRow) => Promise<DeliverResult>;
}

export type SendNowResult =
  { status: 'busy' } | { status: 'unknown-slot' } | { status: 'done'; result: DeliverResult };

export interface ScheduledBroadcastScheduler {
  /** Reconcile (skip-missed) then arm. Idempotent. */
  start: () => Promise<void>;
  stop: () => void;
  /** Re-read slots / master switch and re-arm (call on store or setting changes). */
  refresh: () => Promise<void>;
  /** Power resume: skip-missed reconcile, then re-arm. */
  onPowerResume: () => Promise<void>;
  /** Deliver now without touching `nextDueAt`; refuses when a run is in progress. */
  sendNow: (slot: number) => Promise<SendNowResult>;
  isRunning: () => boolean;
}

export function isScheduledBroadcastsEnabled(): boolean {
  const parsed = parseStoredJson<Record<string, unknown>>(
    getAppSettingsRaw(),
    'isScheduledBroadcastsEnabled',
  );
  return parsed?.[SCHEDULED_BROADCASTS_ENABLED_SETTING] === true;
}

export function createDefaultSchedulerDeps(): SchedulerDeps {
  return {
    now: () => Date.now(),
    isEnabled: isScheduledBroadcastsEnabled,
    getSlots: () =>
      Object.values(useScheduledBroadcastsStore.getState().slots).filter(
        (s): s is ScheduledBroadcastRow => s != null,
      ),
    claimDue: (slot, expected, next, claimedAt) =>
      window.electronAPI.db.claimScheduledBroadcastDue(slot, expected, next, claimedAt),
    saveNextDueAt: (slot, nextDueAt) =>
      useScheduledBroadcastsStore.getState().save({ slot, nextDueAt }),
    setResult: (slot, lastAttemptAt, lastResult) =>
      window.electronAPI.db.setScheduledBroadcastResult(slot, lastAttemptAt, lastResult),
    applyRuntimeState: (slot, patch) => {
      useScheduledBroadcastsStore.getState().applyRuntimeState(slot, patch);
    },
    deliver: (row) => deliverScheduledBroadcast(row, getScheduledBroadcastDeliveryAdapters()),
  };
}

function ruleOf(row: ScheduledBroadcastRow): ScheduledBroadcastRule {
  return {
    interval: row.interval,
    timeOfDayMin: row.timeOfDayMin,
    weekday: row.weekday,
    dayOfMonth: row.dayOfMonth,
    anchorYmd: row.anchorYmd,
  };
}

function logRun(slot: number, outcome: string, textLength: number): void {
  console.debug(`[scheduledBroadcasts] slot=${slot} outcome=${outcome} len=${textLength}`);
}

export function createScheduledBroadcastScheduler(
  overrides: Partial<SchedulerDeps> = {},
): ScheduledBroadcastScheduler {
  const deps: SchedulerDeps = { ...createDefaultSchedulerDeps(), ...overrides };

  let started = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let tickPending = false;
  let reconcilePending = false;
  /** Bumped on power resume; a run in progress stops firing stale slots when it changes. */
  let resumeEpoch = 0;
  let lastEnabled = false;

  const enabledSlots = (): ScheduledBroadcastRow[] => deps.getSlots().filter((s) => s.enabled);

  const clearTimers = (): void => {
    if (timer != null) clearTimeout(timer);
    timer = null;
    if (interval != null) clearInterval(interval);
    interval = null;
  };

  function arm(): void {
    if (timer != null) clearTimeout(timer);
    timer = null;
    if (!started || !deps.isEnabled()) {
      clearTimers();
      return;
    }
    if (running) return; // The run re-arms when it finishes.
    interval ??= setInterval(() => {
      void tick();
    }, SCHEDULER_SAFETY_INTERVAL_MS);
    let earliest: number | null = null;
    for (const s of enabledSlots()) {
      if (s.nextDueAt == null) continue;
      if (earliest == null || s.nextDueAt < earliest) earliest = s.nextDueAt;
    }
    if (earliest == null) return;
    const delay = Math.min(Math.max(earliest - deps.now(), 0), MAX_TIMER_DELAY_MS);
    timer = setTimeout(() => {
      timer = null;
      void tick();
    }, delay);
  }

  /**
   * `skip-missed`: advance every stale `nextDueAt` past now and record `missed`.
   * `fill-null`: only give slots without a `nextDueAt` their first occurrence.
   */
  async function normalizeSlots(mode: 'skip-missed' | 'fill-null'): Promise<void> {
    const now = deps.now();
    for (const row of enabledSlots()) {
      try {
        const rule = ruleOf(row);
        if (row.nextDueAt == null) {
          const next = computeNextDue(rule, now);
          if (next == null) continue;
          await deps.saveNextDueAt(row.slot, next);
          continue;
        }
        if (mode !== 'skip-missed' || row.nextDueAt > now) continue;
        const next = advancePastDue(rule, row.nextDueAt, now);
        if (next == null) {
          console.warn(`[scheduledBroadcasts] slot=${row.slot} has no valid next occurrence`);
          continue;
        }
        const { claimed } = await deps.claimDue(row.slot, row.nextDueAt, next, now);
        if (!claimed) continue;
        const lastResult: ScheduledBroadcastLastResult = {
          at: now,
          outcome: 'missed',
          targets: [],
        };
        await deps.setResult(row.slot, now, lastResult);
        deps.applyRuntimeState(row.slot, { nextDueAt: next, lastResult, lastAttemptAt: now });
        logRun(row.slot, 'missed', row.text.length);
      } catch (e: unknown) {
        console.warn(
          `[scheduledBroadcasts] reconcile slot=${row.slot} failed ` + errLikeToLogString(e),
        );
      }
    }
  }

  async function deliverAndRecord(
    row: ScheduledBroadcastRow,
    advance: { nextDueAt: number | null },
  ): Promise<DeliverResult> {
    let result: DeliverResult;
    try {
      result = await deps.deliver(row);
    } catch (e: unknown) {
      console.warn(`[scheduledBroadcasts] slot=${row.slot} deliver threw ` + errLikeToLogString(e));
      result = { outcome: 'failed', targets: [] };
    }
    const attemptedAt = deps.now();
    const lastResult: ScheduledBroadcastLastResult = {
      at: attemptedAt,
      outcome: result.outcome,
      targets: result.targets,
    };
    try {
      await deps.setResult(row.slot, attemptedAt, lastResult);
    } catch (e: unknown) {
      console.warn(
        `[scheduledBroadcasts] slot=${row.slot} setResult failed ` + errLikeToLogString(e),
      );
    }
    deps.applyRuntimeState(row.slot, {
      nextDueAt: advance.nextDueAt,
      lastResult,
      lastAttemptAt: attemptedAt,
    });
    logRun(row.slot, result.outcome, row.text.length);
    return result;
  }

  /** Claim and fire one due slot. Returns false when it was not fired. */
  async function fireDueSlot(row: ScheduledBroadcastRow): Promise<boolean> {
    const due = row.nextDueAt;
    if (due == null) return false;
    const now = deps.now();
    const next = computeNextDue(ruleOf(row), Math.max(now, due));
    if (next == null) {
      console.warn(`[scheduledBroadcasts] slot=${row.slot} has no valid next occurrence`);
      return false;
    }
    let claimed: boolean;
    try {
      claimed = (await deps.claimDue(row.slot, due, next, now)).claimed;
    } catch (e: unknown) {
      console.warn(`[scheduledBroadcasts] slot=${row.slot} claim failed ` + errLikeToLogString(e));
      return false;
    }
    if (!claimed) return false;
    // Reflect the advance immediately so the UI never shows a stale "due now" during delivery.
    deps.applyRuntimeState(row.slot, {
      nextDueAt: next,
      lastResult: row.lastResult,
      lastAttemptAt: row.lastAttemptAt,
    });
    await deliverAndRecord(row, { nextDueAt: next });
    return true;
  }

  async function finishRun(): Promise<void> {
    running = false;
    const doReconcile = reconcilePending;
    const doTick = tickPending;
    reconcilePending = false;
    tickPending = false;
    if (doReconcile) {
      running = true;
      try {
        await normalizeSlots('skip-missed');
      } finally {
        running = false;
      }
    }
    arm();
    if (doTick && !doReconcile) void tick();
  }

  async function tick(): Promise<void> {
    if (!started) return;
    if (!deps.isEnabled()) {
      arm();
      return;
    }
    if (running) {
      tickPending = true;
      return;
    }
    running = true;
    const epoch = resumeEpoch;
    // Slots already attempted this run, keyed by slot+due so an unclaimable slot cannot spin.
    const attempted = new Set<string>();
    try {
      for (;;) {
        if (!deps.isEnabled() || epoch !== resumeEpoch) break;
        const now = deps.now();
        const due = enabledSlots()
          .filter(
            (s) =>
              s.nextDueAt != null &&
              s.nextDueAt <= now &&
              !attempted.has(`${s.slot}@${s.nextDueAt}`),
          )
          .sort((a, b) => (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0) || a.slot - b.slot);
        const row = due.at(0);
        if (!row) break;
        attempted.add(`${row.slot}@${row.nextDueAt}`);
        await fireDueSlot(row);
      }
    } catch (e: unknown) {
      console.warn('[scheduledBroadcasts] tick failed ' + errLikeToLogString(e));
    } finally {
      await finishRun();
    }
  }

  return {
    async start() {
      started = true;
      lastEnabled = deps.isEnabled();
      if (lastEnabled) await normalizeSlots('skip-missed');
      arm();
    },

    stop() {
      started = false;
      clearTimers();
      tickPending = false;
      reconcilePending = false;
    },

    async refresh() {
      if (!started) return;
      const enabled = deps.isEnabled();
      const justEnabled = enabled && !lastEnabled;
      lastEnabled = enabled;
      if (enabled && !running) {
        // Turning the switch on after a long off period must not replay what it missed.
        await normalizeSlots(justEnabled ? 'skip-missed' : 'fill-null');
      }
      arm();
    },

    async onPowerResume() {
      if (!started) return;
      resumeEpoch += 1;
      if (running) {
        reconcilePending = true;
        return;
      }
      if (deps.isEnabled()) {
        running = true;
        try {
          await normalizeSlots('skip-missed');
        } finally {
          running = false;
        }
      }
      arm();
    },

    async sendNow(slot) {
      const row = deps.getSlots().find((s) => s.slot === slot);
      if (!row) return { status: 'unknown-slot' };
      if (running) return { status: 'busy' };
      running = true;
      try {
        const result = await deliverAndRecord(row, { nextDueAt: row.nextDueAt });
        return { status: 'done', result };
      } finally {
        await finishRun();
      }
    },

    isRunning: () => running,
  };
}

let singleton: ScheduledBroadcastScheduler | null = null;

/** App-wide scheduler (lazy). Tests inject deps through `createScheduledBroadcastScheduler`. */
export function getScheduledBroadcastScheduler(): ScheduledBroadcastScheduler {
  singleton ??= createScheduledBroadcastScheduler();
  return singleton;
}

export function resetScheduledBroadcastSchedulerForTests(): void {
  singleton?.stop();
  singleton = null;
}
