import { ipcMain } from 'electron';

import {
  SCHEDULED_BROADCAST_INTERVALS,
  SCHEDULED_BROADCAST_LABEL_MAX,
  SCHEDULED_BROADCAST_MAX_TARGETS,
  SCHEDULED_BROADCAST_SLOT_COUNT,
  SCHEDULED_BROADCAST_TARGET_KINDS,
  SCHEDULED_BROADCAST_TEXT_MAX,
  type ScheduledBroadcastInput,
  type ScheduledBroadcastInterval,
  type ScheduledBroadcastLastResult,
  type ScheduledBroadcastRow,
  type ScheduledBroadcastRunOutcome,
  type ScheduledBroadcastTarget,
  type ScheduledBroadcastTargetKind,
} from '../../shared/scheduledBroadcastTypes';
import { getDatabase } from '../database';
import type { NodeSqliteDB } from '../db-compat';
import { assertIpcSender } from '../validate-ipc-sender';

const TARGETS_JSON_MAX = 16 * 1024;
const LAST_RESULT_JSON_MAX = 8 * 1024;
const INTERVAL_SET = new Set<string>(SCHEDULED_BROADCAST_INTERVALS);
const KIND_SET = new Set<string>(SCHEDULED_BROADCAST_TARGET_KINDS);
const OUTCOME_SET = new Set<string>(['sent', 'partial', 'failed', 'skipped', 'missed']);

interface DbRow {
  slot: number;
  label: string;
  text: string;
  enabled: number;
  interval: string;
  time_of_day_min: number;
  weekday: number | null;
  day_of_month: number | null;
  anchor_ymd: string | null;
  next_due_at: number | null;
  last_attempt_at: number | null;
  last_result_json: string | null;
  targets_json: string;
  updated_at: number;
}

function assertSlot(slot: unknown): number {
  if (
    !Number.isInteger(slot) ||
    (slot as number) < 1 ||
    (slot as number) > SCHEDULED_BROADCAST_SLOT_COUNT
  ) {
    throw new TypeError(
      `scheduled broadcast slot must be an integer 1–${SCHEDULED_BROADCAST_SLOT_COUNT}`,
    );
  }
  return slot as number;
}

function parseTargetsJson(raw: string): ScheduledBroadcastTarget[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // catch-no-log-ok malformed targets_json from legacy/corrupt rows → empty list
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isValidTargetStored) as ScheduledBroadcastTarget[];
}

function isValidTargetStored(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  if (!KIND_SET.has(String(o.kind))) return false;
  if (typeof o.identityId !== 'string' || !o.identityId) return false;
  if (typeof o.label !== 'string') return false;
  if (typeof o.enabled !== 'boolean') return false;
  return true;
}

function isValidTargetResultStored(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  if (!KIND_SET.has(String(o.kind))) return false;
  if (typeof o.label !== 'string') return false;
  if (typeof o.ok !== 'boolean') return false;
  if (o.reason != null && typeof o.reason !== 'string') return false;
  return true;
}

function parseLastResult(raw: string | null): ScheduledBroadcastLastResult | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (
      !Number.isFinite(o.at) ||
      !OUTCOME_SET.has(String(o.outcome)) ||
      !Array.isArray(o.targets)
    ) {
      return null;
    }
    if (o.targets.length > SCHEDULED_BROADCAST_MAX_TARGETS) return null;
    const targets = o.targets.filter(isValidTargetResultStored).map((entry) => {
      const t = entry as Record<string, unknown>;
      const result: ScheduledBroadcastLastResult['targets'][number] = {
        kind: t.kind as ScheduledBroadcastTargetKind,
        label: t.label as string,
        ok: t.ok as boolean,
      };
      if (typeof t.reason === 'string') result.reason = t.reason;
      return result;
    });
    if (targets.length !== o.targets.length) return null;
    return {
      at: o.at as number,
      outcome: o.outcome as ScheduledBroadcastRunOutcome,
      targets,
    };
  } catch {
    // catch-no-log-ok malformed last_result_json → treat as no result
    return null;
  }
}

function rowFromDb(r: DbRow): ScheduledBroadcastRow {
  return {
    slot: r.slot,
    label: r.label,
    text: r.text,
    enabled: r.enabled === 1,
    interval: r.interval as ScheduledBroadcastInterval,
    timeOfDayMin: r.time_of_day_min,
    weekday: r.weekday,
    dayOfMonth: r.day_of_month,
    anchorYmd: r.anchor_ymd,
    nextDueAt: r.next_due_at,
    lastAttemptAt: r.last_attempt_at,
    lastResult: parseLastResult(r.last_result_json),
    targets: parseTargetsJson(r.targets_json),
    updatedAt: r.updated_at,
  };
}

function validateTarget(t: unknown, index: number): ScheduledBroadcastTarget {
  if (!t || typeof t !== 'object') {
    throw new TypeError(`targets[${index}] must be an object`);
  }
  const o = t as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) {
    throw new TypeError(`targets[${index}].kind invalid`);
  }
  const identityId = o.identityId;
  if (typeof identityId !== 'string' || !identityId || identityId.length > 128) {
    throw new TypeError(`targets[${index}].identityId invalid`);
  }
  const label = typeof o.label === 'string' ? o.label.slice(0, 128) : '';
  const enabled = o.enabled === true;
  const target: ScheduledBroadcastTarget = {
    kind: kind as ScheduledBroadcastTargetKind,
    identityId,
    label,
    enabled,
  };
  if (kind === 'meshtastic-channel' || kind === 'meshcore-channel') {
    if (
      !Number.isInteger(o.channelIndex) ||
      (o.channelIndex as number) < 0 ||
      (o.channelIndex as number) > 255
    ) {
      throw new TypeError(`targets[${index}].channelIndex invalid`);
    }
    target.channelIndex = o.channelIndex as number;
    if (o.channelKey != null) {
      if (typeof o.channelKey !== 'string' || !/^[0-9a-fA-F]{8,128}$/.test(o.channelKey)) {
        throw new TypeError(`targets[${index}].channelKey invalid`);
      }
      target.channelKey = o.channelKey.toLowerCase();
    }
  }
  if (kind === 'meshcore-room') {
    if (typeof o.roomPubKeyHex !== 'string' || !/^[0-9a-fA-F]{8,128}$/.test(o.roomPubKeyHex)) {
      throw new TypeError(`targets[${index}].roomPubKeyHex invalid`);
    }
    target.roomPubKeyHex = o.roomPubKeyHex.toLowerCase();
    if (o.roomNodeId != null) {
      if (!Number.isInteger(o.roomNodeId) || (o.roomNodeId as number) < 0) {
        throw new TypeError(`targets[${index}].roomNodeId invalid`);
      }
      target.roomNodeId = o.roomNodeId as number;
    }
  }
  if (kind === 'rrc-room') {
    if (typeof o.hubDestHash !== 'string' || !o.hubDestHash || o.hubDestHash.length > 128) {
      throw new TypeError(`targets[${index}].hubDestHash invalid`);
    }
    if (typeof o.room !== 'string' || !o.room || o.room.length > 256) {
      throw new TypeError(`targets[${index}].room invalid`);
    }
    target.hubDestHash = o.hubDestHash;
    target.room = o.room;
  }
  return target;
}

function validateTargets(raw: unknown): ScheduledBroadcastTarget[] {
  if (!Array.isArray(raw)) throw new TypeError('targets must be an array');
  if (raw.length > SCHEDULED_BROADCAST_MAX_TARGETS) {
    throw new TypeError(`targets length must be ≤ ${SCHEDULED_BROADCAST_MAX_TARGETS}`);
  }
  const targets = raw.map((t, i) => validateTarget(t, i));
  const json = JSON.stringify(targets);
  if (json.length > TARGETS_JSON_MAX) {
    throw new TypeError('targets_json too large');
  }
  return targets;
}

function validateTargetResult(
  t: unknown,
  index: number,
): ScheduledBroadcastLastResult['targets'][number] {
  if (!t || typeof t !== 'object') {
    throw new TypeError(`lastResult.targets[${index}] must be an object`);
  }
  const o = t as Record<string, unknown>;
  if (typeof o.kind !== 'string' || !KIND_SET.has(o.kind)) {
    throw new TypeError(`lastResult.targets[${index}].kind invalid`);
  }
  if (typeof o.label !== 'string') {
    throw new TypeError(`lastResult.targets[${index}].label invalid`);
  }
  if (typeof o.ok !== 'boolean') {
    throw new TypeError(`lastResult.targets[${index}].ok invalid`);
  }
  if (o.reason != null && typeof o.reason !== 'string') {
    throw new TypeError(`lastResult.targets[${index}].reason invalid`);
  }
  const entry: ScheduledBroadcastLastResult['targets'][number] = {
    kind: o.kind as ScheduledBroadcastTargetKind,
    label: o.label,
    ok: o.ok,
  };
  if (typeof o.reason === 'string') entry.reason = o.reason;
  return entry;
}

function validateLastResult(raw: unknown): ScheduledBroadcastLastResult {
  if (!raw || typeof raw !== 'object') throw new TypeError('lastResult must be an object');
  const o = raw as Record<string, unknown>;
  if (!Number.isFinite(o.at)) throw new TypeError('lastResult.at invalid');
  if (typeof o.outcome !== 'string' || !OUTCOME_SET.has(o.outcome)) {
    throw new TypeError('lastResult.outcome invalid');
  }
  if (!Array.isArray(o.targets)) throw new TypeError('lastResult.targets invalid');
  if (o.targets.length > SCHEDULED_BROADCAST_MAX_TARGETS) {
    throw new TypeError(`lastResult.targets length must be ≤ ${SCHEDULED_BROADCAST_MAX_TARGETS}`);
  }
  const result: ScheduledBroadcastLastResult = {
    at: o.at as number,
    outcome: o.outcome as ScheduledBroadcastRunOutcome,
    targets: o.targets.map((entry, i) => validateTargetResult(entry, i)),
  };
  const json = JSON.stringify(result);
  if (json.length > LAST_RESULT_JSON_MAX) throw new TypeError('last_result_json too large');
  return result;
}

function readRow(db: NodeSqliteDB, slot: number): ScheduledBroadcastRow | null {
  const r = db.prepareOnce('SELECT * FROM scheduled_broadcasts WHERE slot = ?').get(slot) as
    DbRow | undefined;
  return r ? rowFromDb(r) : null;
}

function listRows(db: NodeSqliteDB): ScheduledBroadcastRow[] {
  const rows = db
    .prepareOnce('SELECT * FROM scheduled_broadcasts ORDER BY slot ASC')
    .all() as DbRow[];
  return rows.map(rowFromDb);
}

function mergeInput(
  existing: ScheduledBroadcastRow | null,
  input: ScheduledBroadcastInput,
  now: number,
): ScheduledBroadcastRow {
  const base: ScheduledBroadcastRow = existing ?? {
    slot: input.slot,
    label: '',
    text: '',
    enabled: false,
    interval: 'weekly',
    timeOfDayMin: 540,
    weekday: null,
    dayOfMonth: null,
    anchorYmd: null,
    nextDueAt: null,
    lastAttemptAt: null,
    lastResult: null,
    targets: [],
    updatedAt: now,
  };

  const next: ScheduledBroadcastRow = { ...base, updatedAt: now };

  if (input.label !== undefined) {
    if (typeof input.label !== 'string' || input.label.length > SCHEDULED_BROADCAST_LABEL_MAX) {
      throw new TypeError('label invalid');
    }
    next.label = input.label;
  }
  if (input.text !== undefined) {
    if (typeof input.text !== 'string' || input.text.length > SCHEDULED_BROADCAST_TEXT_MAX) {
      throw new TypeError('text invalid');
    }
    next.text = input.text;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') throw new TypeError('enabled invalid');
    next.enabled = input.enabled;
  }
  if (input.interval !== undefined) {
    if (typeof input.interval !== 'string' || !INTERVAL_SET.has(input.interval)) {
      throw new TypeError('interval invalid');
    }
    next.interval = input.interval;
  }
  if (input.timeOfDayMin !== undefined) {
    if (
      !Number.isInteger(input.timeOfDayMin) ||
      input.timeOfDayMin < 0 ||
      input.timeOfDayMin > 1439
    ) {
      throw new TypeError('timeOfDayMin invalid');
    }
    next.timeOfDayMin = input.timeOfDayMin;
  }
  if (input.weekday !== undefined) {
    if (
      input.weekday !== null &&
      (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)
    ) {
      throw new TypeError('weekday invalid');
    }
    next.weekday = input.weekday;
  }
  if (input.dayOfMonth !== undefined) {
    if (
      input.dayOfMonth !== null &&
      (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31)
    ) {
      throw new TypeError('dayOfMonth invalid');
    }
    next.dayOfMonth = input.dayOfMonth;
  }
  if (input.anchorYmd !== undefined) {
    if (
      input.anchorYmd !== null &&
      (typeof input.anchorYmd !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.anchorYmd))
    ) {
      throw new TypeError('anchorYmd invalid');
    }
    next.anchorYmd = input.anchorYmd;
  }
  if (input.nextDueAt !== undefined) {
    if (input.nextDueAt !== null && !Number.isFinite(input.nextDueAt)) {
      throw new TypeError('nextDueAt invalid');
    }
    next.nextDueAt = input.nextDueAt;
  }
  if (input.lastAttemptAt !== undefined) {
    if (input.lastAttemptAt !== null && !Number.isFinite(input.lastAttemptAt)) {
      throw new TypeError('lastAttemptAt invalid');
    }
    next.lastAttemptAt = input.lastAttemptAt;
  }
  if (input.lastResult !== undefined) {
    next.lastResult = input.lastResult === null ? null : validateLastResult(input.lastResult);
  }
  if (input.targets !== undefined) {
    next.targets = validateTargets(input.targets);
  }
  return next;
}

function upsertRow(db: NodeSqliteDB, row: ScheduledBroadcastRow): ScheduledBroadcastRow {
  db.prepareOnce(
    `INSERT INTO scheduled_broadcasts (
      slot, label, text, enabled, interval, time_of_day_min, weekday, day_of_month,
      anchor_ymd, next_due_at, last_attempt_at, last_result_json, targets_json, updated_at
    ) VALUES (
      @slot, @label, @text, @enabled, @interval, @time_of_day_min, @weekday, @day_of_month,
      @anchor_ymd, @next_due_at, @last_attempt_at, @last_result_json, @targets_json, @updated_at
    )
    ON CONFLICT(slot) DO UPDATE SET
      label = excluded.label,
      text = excluded.text,
      enabled = excluded.enabled,
      interval = excluded.interval,
      time_of_day_min = excluded.time_of_day_min,
      weekday = excluded.weekday,
      day_of_month = excluded.day_of_month,
      anchor_ymd = excluded.anchor_ymd,
      next_due_at = excluded.next_due_at,
      last_attempt_at = excluded.last_attempt_at,
      last_result_json = excluded.last_result_json,
      targets_json = excluded.targets_json,
      updated_at = excluded.updated_at`,
  ).run({
    slot: row.slot,
    label: row.label,
    text: row.text,
    enabled: row.enabled ? 1 : 0,
    interval: row.interval,
    time_of_day_min: row.timeOfDayMin,
    weekday: row.weekday,
    day_of_month: row.dayOfMonth,
    anchor_ymd: row.anchorYmd,
    next_due_at: row.nextDueAt,
    last_attempt_at: row.lastAttemptAt,
    last_result_json: row.lastResult ? JSON.stringify(row.lastResult) : null,
    targets_json: JSON.stringify(row.targets),
    updated_at: row.updatedAt,
  });
  return readRow(db, row.slot)!;
}

/** Scheduled-broadcast CRUD + claim CAS for the renderer scheduler. */
export function registerScheduledBroadcastIpcHandlers(): void {
  ipcMain.handle('db:listScheduledBroadcasts', (event) => {
    assertIpcSender(event, 'db:listScheduledBroadcasts');
    return listRows(getDatabase());
  });

  ipcMain.handle('db:saveScheduledBroadcast', (event, raw: unknown) => {
    assertIpcSender(event, 'db:saveScheduledBroadcast');
    if (!raw || typeof raw !== 'object') throw new TypeError('input must be an object');
    const input = raw as ScheduledBroadcastInput;
    const slot = assertSlot(input.slot);
    const db = getDatabase();
    const existing = readRow(db, slot);
    const now = Date.now();
    const merged = mergeInput(existing, { ...input, slot }, now);
    return upsertRow(db, merged);
  });

  ipcMain.handle('db:deleteScheduledBroadcast', (event, slotRaw: unknown) => {
    assertIpcSender(event, 'db:deleteScheduledBroadcast');
    const slot = assertSlot(slotRaw);
    getDatabase().prepareOnce('DELETE FROM scheduled_broadcasts WHERE slot = ?').run(slot);
  });

  ipcMain.handle('db:clearScheduledBroadcasts', (event) => {
    assertIpcSender(event, 'db:clearScheduledBroadcasts');
    getDatabase().prepareOnce('DELETE FROM scheduled_broadcasts').run();
  });

  ipcMain.handle(
    'db:claimScheduledBroadcastDue',
    (
      event,
      slotRaw: unknown,
      expectedNextDueAt: unknown,
      nextDueAt: unknown,
      claimedAt: unknown,
    ) => {
      assertIpcSender(event, 'db:claimScheduledBroadcastDue');
      const slot = assertSlot(slotRaw);
      if (
        !Number.isFinite(expectedNextDueAt) ||
        !Number.isFinite(nextDueAt) ||
        !Number.isFinite(claimedAt)
      ) {
        throw new TypeError('claim times must be finite numbers');
      }
      const result = getDatabase()
        .prepareOnce(
          `UPDATE scheduled_broadcasts
           SET next_due_at = ?, updated_at = ?
           WHERE slot = ? AND next_due_at = ?`,
        )
        .run(nextDueAt, claimedAt, slot, expectedNextDueAt);
      return { claimed: result.changes === 1 };
    },
  );

  ipcMain.handle(
    'db:setScheduledBroadcastResult',
    (event, slotRaw: unknown, lastAttemptAt: unknown, lastResult: unknown) => {
      assertIpcSender(event, 'db:setScheduledBroadcastResult');
      const slot = assertSlot(slotRaw);
      if (!Number.isFinite(lastAttemptAt)) throw new TypeError('lastAttemptAt invalid');
      const validated = validateLastResult(lastResult);
      getDatabase()
        .prepareOnce(
          `UPDATE scheduled_broadcasts
           SET last_attempt_at = ?, last_result_json = ?, updated_at = ?
           WHERE slot = ?`,
        )
        .run(lastAttemptAt, JSON.stringify(validated), Date.now(), slot);
    },
  );
}
