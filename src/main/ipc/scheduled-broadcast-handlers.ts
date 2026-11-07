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
const HEX_KEY_RE = /^[0-9a-fA-F]{8,128}$/;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function fail(msg: string): never {
  throw new TypeError(msg);
}

function assertSlot(slot: unknown): number {
  if (
    !Number.isInteger(slot) ||
    (slot as number) < 1 ||
    (slot as number) > SCHEDULED_BROADCAST_SLOT_COUNT
  ) {
    fail(`slot must be 1–${SCHEDULED_BROADCAST_SLOT_COUNT}`);
  }
  return slot as number;
}

function isValidTargetStored(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  return (
    KIND_SET.has(String(o.kind)) &&
    typeof o.identityId === 'string' &&
    !!o.identityId &&
    typeof o.label === 'string' &&
    typeof o.enabled === 'boolean'
  );
}

function isValidTargetResultStored(t: unknown): boolean {
  if (!t || typeof t !== 'object') return false;
  const o = t as Record<string, unknown>;
  return (
    KIND_SET.has(String(o.kind)) &&
    typeof o.label === 'string' &&
    typeof o.ok === 'boolean' &&
    (o.reason == null || typeof o.reason === 'string')
  );
}

function parseTargetsJson(raw: string): ScheduledBroadcastTarget[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTargetStored) as ScheduledBroadcastTarget[];
  } catch {
    // catch-no-log-ok malformed targets_json from legacy/corrupt rows → empty list
    return [];
  }
}

function parseLastResult(raw: string | null): ScheduledBroadcastLastResult | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    if (
      !Number.isFinite(o.at) ||
      !OUTCOME_SET.has(String(o.outcome)) ||
      !Array.isArray(o.targets)
    ) {
      return null;
    }
    if (
      o.targets.length > SCHEDULED_BROADCAST_MAX_TARGETS ||
      !o.targets.every(isValidTargetResultStored)
    ) {
      return null;
    }
    return {
      at: o.at as number,
      outcome: o.outcome as ScheduledBroadcastRunOutcome,
      targets: o.targets as ScheduledBroadcastLastResult['targets'],
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
  if (!t || typeof t !== 'object') fail(`targets[${index}]`);
  const o = t as Record<string, unknown>;
  const kind = o.kind;
  if (typeof kind !== 'string' || !KIND_SET.has(kind)) fail(`targets[${index}].kind`);
  const identityId = o.identityId;
  if (typeof identityId !== 'string' || !identityId || identityId.length > 128) {
    fail(`targets[${index}].identityId`);
  }
  const target: ScheduledBroadcastTarget = {
    kind: kind as ScheduledBroadcastTargetKind,
    identityId,
    label: typeof o.label === 'string' ? o.label.slice(0, 128) : '',
    enabled: o.enabled === true,
  };
  if (kind === 'meshtastic-channel' || kind === 'meshcore-channel') {
    if (
      !Number.isInteger(o.channelIndex) ||
      (o.channelIndex as number) < 0 ||
      (o.channelIndex as number) > 255
    ) {
      fail(`targets[${index}].channelIndex`);
    }
    target.channelIndex = o.channelIndex as number;
    if (o.channelKey != null) {
      if (typeof o.channelKey !== 'string' || !HEX_KEY_RE.test(o.channelKey)) {
        fail(`targets[${index}].channelKey`);
      }
      target.channelKey = o.channelKey.toLowerCase();
    }
  } else if (kind === 'meshcore-room') {
    if (typeof o.roomPubKeyHex !== 'string' || !HEX_KEY_RE.test(o.roomPubKeyHex)) {
      fail(`targets[${index}].roomPubKeyHex`);
    }
    target.roomPubKeyHex = o.roomPubKeyHex.toLowerCase();
    if (o.roomNodeId != null) {
      if (!Number.isInteger(o.roomNodeId) || (o.roomNodeId as number) < 0) {
        fail(`targets[${index}].roomNodeId`);
      }
      target.roomNodeId = o.roomNodeId as number;
    }
  } else if (kind === 'rrc-room') {
    if (typeof o.hubDestHash !== 'string' || !o.hubDestHash || o.hubDestHash.length > 128) {
      fail(`targets[${index}].hubDestHash`);
    }
    if (typeof o.room !== 'string' || !o.room || o.room.length > 256) {
      fail(`targets[${index}].room`);
    }
    target.hubDestHash = o.hubDestHash;
    target.room = o.room;
  }
  return target;
}

function validateTargets(raw: unknown): ScheduledBroadcastTarget[] {
  if (!Array.isArray(raw)) fail('targets');
  if (raw.length > SCHEDULED_BROADCAST_MAX_TARGETS) fail('targets length');
  const targets = raw.map((t, i) => validateTarget(t, i));
  if (JSON.stringify(targets).length > TARGETS_JSON_MAX) fail('targets_json');
  return targets;
}

function validateTargetResult(
  t: unknown,
  index: number,
): ScheduledBroadcastLastResult['targets'][number] {
  if (!isValidTargetResultStored(t)) fail(`lastResult.targets[${index}]`);
  const o = t as Record<string, unknown>;
  const entry: ScheduledBroadcastLastResult['targets'][number] = {
    kind: o.kind as ScheduledBroadcastTargetKind,
    label: o.label as string,
    ok: o.ok as boolean,
  };
  if (typeof o.reason === 'string') entry.reason = o.reason;
  return entry;
}

function validateLastResult(raw: unknown): ScheduledBroadcastLastResult {
  if (!raw || typeof raw !== 'object') fail('lastResult');
  const o = raw as Record<string, unknown>;
  if (!Number.isFinite(o.at)) fail('lastResult.at');
  if (typeof o.outcome !== 'string' || !OUTCOME_SET.has(o.outcome)) fail('lastResult.outcome');
  if (!Array.isArray(o.targets)) fail('lastResult.targets');
  if (o.targets.length > SCHEDULED_BROADCAST_MAX_TARGETS) fail('lastResult.targets length');
  const result: ScheduledBroadcastLastResult = {
    at: o.at as number,
    outcome: o.outcome as ScheduledBroadcastRunOutcome,
    targets: o.targets.map((entry, i) => validateTargetResult(entry, i)),
  };
  if (JSON.stringify(result).length > LAST_RESULT_JSON_MAX) fail('last_result_json');
  return result;
}

function readRow(db: NodeSqliteDB, slot: number): ScheduledBroadcastRow | null {
  const r = db.prepareOnce('SELECT * FROM scheduled_broadcasts WHERE slot = ?').get(slot) as
    DbRow | undefined;
  return r ? rowFromDb(r) : null;
}

function listRows(db: NodeSqliteDB): ScheduledBroadcastRow[] {
  return (
    db.prepareOnce('SELECT * FROM scheduled_broadcasts ORDER BY slot ASC').all() as DbRow[]
  ).map(rowFromDb);
}

function mergeInput(
  existing: ScheduledBroadcastRow | null,
  input: ScheduledBroadcastInput,
  now: number,
): ScheduledBroadcastRow {
  const next: ScheduledBroadcastRow = {
    ...(existing ?? {
      slot: input.slot,
      label: '',
      text: '',
      enabled: false,
      interval: 'weekly' as const,
      timeOfDayMin: 540,
      weekday: null,
      dayOfMonth: null,
      anchorYmd: null,
      nextDueAt: null,
      lastAttemptAt: null,
      lastResult: null,
      targets: [],
      updatedAt: now,
    }),
    updatedAt: now,
  };

  if (input.label !== undefined) {
    if (typeof input.label !== 'string' || input.label.length > SCHEDULED_BROADCAST_LABEL_MAX) {
      fail('label');
    }
    next.label = input.label;
  }
  if (input.text !== undefined) {
    if (typeof input.text !== 'string' || input.text.length > SCHEDULED_BROADCAST_TEXT_MAX) {
      fail('text');
    }
    next.text = input.text;
  }
  if (input.enabled !== undefined) {
    if (typeof input.enabled !== 'boolean') fail('enabled');
    next.enabled = input.enabled;
  }
  if (input.interval !== undefined) {
    if (typeof input.interval !== 'string' || !INTERVAL_SET.has(input.interval)) fail('interval');
    next.interval = input.interval;
  }
  if (input.timeOfDayMin !== undefined) {
    if (
      !Number.isInteger(input.timeOfDayMin) ||
      input.timeOfDayMin < 0 ||
      input.timeOfDayMin > 1439
    ) {
      fail('timeOfDayMin');
    }
    next.timeOfDayMin = input.timeOfDayMin;
  }
  if (input.weekday !== undefined) {
    if (
      input.weekday !== null &&
      (!Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6)
    ) {
      fail('weekday');
    }
    next.weekday = input.weekday;
  }
  if (input.dayOfMonth !== undefined) {
    if (
      input.dayOfMonth !== null &&
      (!Number.isInteger(input.dayOfMonth) || input.dayOfMonth < 1 || input.dayOfMonth > 31)
    ) {
      fail('dayOfMonth');
    }
    next.dayOfMonth = input.dayOfMonth;
  }
  if (input.anchorYmd !== undefined) {
    if (
      input.anchorYmd !== null &&
      (typeof input.anchorYmd !== 'string' || !YMD_RE.test(input.anchorYmd))
    ) {
      fail('anchorYmd');
    }
    next.anchorYmd = input.anchorYmd;
  }
  if (input.nextDueAt !== undefined) {
    if (input.nextDueAt !== null && !Number.isFinite(input.nextDueAt)) fail('nextDueAt');
    next.nextDueAt = input.nextDueAt;
  }
  if (input.lastAttemptAt !== undefined) {
    if (input.lastAttemptAt !== null && !Number.isFinite(input.lastAttemptAt))
      fail('lastAttemptAt');
    next.lastAttemptAt = input.lastAttemptAt;
  }
  if (input.lastResult !== undefined) {
    next.lastResult = input.lastResult === null ? null : validateLastResult(input.lastResult);
  }
  if (input.targets !== undefined) next.targets = validateTargets(input.targets);
  return next;
}

function upsertRow(db: NodeSqliteDB, row: ScheduledBroadcastRow): ScheduledBroadcastRow {
  db.prepareOnce(
    `INSERT INTO scheduled_broadcasts (
slot,label,text,enabled,interval,time_of_day_min,weekday,day_of_month,
anchor_ymd,next_due_at,last_attempt_at,last_result_json,targets_json,updated_at
) VALUES (
@slot,@label,@text,@enabled,@interval,@time_of_day_min,@weekday,@day_of_month,
@anchor_ymd,@next_due_at,@last_attempt_at,@last_result_json,@targets_json,@updated_at
) ON CONFLICT(slot) DO UPDATE SET
label=excluded.label,text=excluded.text,enabled=excluded.enabled,interval=excluded.interval,
time_of_day_min=excluded.time_of_day_min,weekday=excluded.weekday,day_of_month=excluded.day_of_month,
anchor_ymd=excluded.anchor_ymd,next_due_at=excluded.next_due_at,last_attempt_at=excluded.last_attempt_at,
last_result_json=excluded.last_result_json,targets_json=excluded.targets_json,updated_at=excluded.updated_at`,
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
    if (!raw || typeof raw !== 'object') fail('input');
    const input = raw as ScheduledBroadcastInput;
    const slot = assertSlot(input.slot);
    const db = getDatabase();
    return upsertRow(db, mergeInput(readRow(db, slot), { ...input, slot }, Date.now()));
  });

  ipcMain.handle('db:deleteScheduledBroadcast', (event, slotRaw: unknown) => {
    assertIpcSender(event, 'db:deleteScheduledBroadcast');
    getDatabase()
      .prepareOnce('DELETE FROM scheduled_broadcasts WHERE slot = ?')
      .run(assertSlot(slotRaw));
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
        fail('claim times');
      }
      const result = getDatabase()
        .prepareOnce(
          'UPDATE scheduled_broadcasts SET next_due_at=?,updated_at=? WHERE slot=? AND next_due_at=?',
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
      if (!Number.isFinite(lastAttemptAt)) fail('lastAttemptAt');
      const validated = validateLastResult(lastResult);
      getDatabase()
        .prepareOnce(
          'UPDATE scheduled_broadcasts SET last_attempt_at=?,last_result_json=?,updated_at=? WHERE slot=?',
        )
        .run(lastAttemptAt, JSON.stringify(validated), Date.now(), slot);
    },
  );
}
