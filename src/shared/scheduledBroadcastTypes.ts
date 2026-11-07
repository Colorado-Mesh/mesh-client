/** Durable scheduled-broadcast slots (SQLite `scheduled_broadcasts`). */

export type ScheduledBroadcastInterval = 'hourly' | 'daily' | 'weekly' | 'biweekly' | 'monthly';

export type ScheduledBroadcastTargetKind =
  'meshtastic-channel' | 'meshcore-channel' | 'meshcore-room' | 'rrc-room';

export interface ScheduledBroadcastTarget {
  kind: ScheduledBroadcastTargetKind;
  /** Identity whose radio must be connected to deliver. */
  identityId: string;
  /** Display snapshot; refreshed from live data at render time, never used for routing. */
  label: string;
  enabled: boolean;
  /** `*-channel` only. */
  channelIndex?: number;
  /** `meshcore-room` only — stable across nodeId churn. */
  roomPubKeyHex?: string;
  /** `meshcore-room` only — cached, resolved live before send. */
  roomNodeId?: number;
  /** `rrc-room` only. */
  hubDestHash?: string;
  room?: string;
}

export type ScheduledBroadcastRunOutcome = 'sent' | 'partial' | 'failed' | 'skipped' | 'missed';

export interface ScheduledBroadcastTargetResult {
  kind: ScheduledBroadcastTargetKind;
  label: string;
  ok: boolean;
  reason?: string;
}

export interface ScheduledBroadcastLastResult {
  at: number;
  outcome: ScheduledBroadcastRunOutcome;
  targets: ScheduledBroadcastTargetResult[];
}

export interface ScheduledBroadcastRow {
  slot: number;
  label: string;
  text: string;
  enabled: boolean;
  interval: ScheduledBroadcastInterval;
  timeOfDayMin: number;
  weekday: number | null;
  dayOfMonth: number | null;
  anchorYmd: string | null;
  nextDueAt: number | null;
  lastAttemptAt: number | null;
  lastResult: ScheduledBroadcastLastResult | null;
  targets: ScheduledBroadcastTarget[];
  updatedAt: number;
}

/** Patch shape accepted by `db:saveScheduledBroadcast`; `slot` is required. */
export type ScheduledBroadcastInput = Partial<Omit<ScheduledBroadcastRow, 'slot' | 'updatedAt'>> & {
  slot: number;
};

export const SCHEDULED_BROADCAST_INTERVALS: readonly ScheduledBroadcastInterval[] = [
  'hourly',
  'daily',
  'weekly',
  'biweekly',
  'monthly',
] as const;

export const SCHEDULED_BROADCAST_TARGET_KINDS: readonly ScheduledBroadcastTargetKind[] = [
  'meshtastic-channel',
  'meshcore-channel',
  'meshcore-room',
  'rrc-room',
] as const;

export const SCHEDULED_BROADCAST_SLOT_COUNT = 12;
export const SCHEDULED_BROADCAST_MAX_TARGETS = 8;
export const SCHEDULED_BROADCAST_TEXT_MAX = 2000;
export const SCHEDULED_BROADCAST_LABEL_MAX = 48;
