/** Helpers for RRC WELCOME hub byte limits (nick / room name / message body). */

import { countMessageWireBytes } from '@/renderer/lib/chatComposerLimits';
import { parseRrcSlashInput } from '@/renderer/lib/rrcSlashCommands';
import type { RrcHubLimits } from '@/shared/rrc-types';

export type RrcByteLimitPhase = 'ok' | 'warn' | 'overMax';

export interface RrcByteLimitStatus {
  byteCount: number;
  limit: number;
  phase: RrcByteLimitPhase;
  showThreshold: number;
}

/**
 * Typical RNS Link MDU for RRC traffic (rrcd `/who` / MSG frames).
 * When a hub omits WELCOME `max_msg_body_bytes`, plain chat uses a body budget
 * below this so the full envelope still fits a single link frame.
 */
export const RRC_TYPICAL_LINK_MDU_BYTES = 431;

/**
 * Conservative msgpack framing budget (msg type, identity hash, room, nick, map keys)
 * for a typical RRC MSG/ACTION/NOTICE body on a Link.
 */
export const RRC_MSG_ENVELOPE_OVERHEAD_BUDGET_BYTES = 96;

/** Plain-chat body cap when the hub did not advertise `max_msg_body_bytes`. */
export const RRC_FALLBACK_MAX_MSG_BODY_BYTES =
  RRC_TYPICAL_LINK_MDU_BYTES - RRC_MSG_ENVELOPE_OVERHEAD_BUDGET_BYTES;

/** Normalize optional hub limit integers (reject non-positive). */
export function normalizeRrcHubByteLimit(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n > 0 ? n : null;
}

/** Hub WELCOME body limit, or Link-MDU-safe fallback when the hub omits one. */
export function resolveRrcMsgBodyLimit(hubLimit: number | null | undefined): number {
  return normalizeRrcHubByteLimit(hubLimit ?? null) ?? RRC_FALLBACK_MAX_MSG_BODY_BYTES;
}

export function parseRrcHubLimits(raw: unknown): RrcHubLimits {
  if (!raw || typeof raw !== 'object') return {};
  const o = raw as Record<string, unknown>;
  return {
    max_nick_bytes: normalizeRrcHubByteLimit(o.max_nick_bytes),
    max_room_name_bytes: normalizeRrcHubByteLimit(o.max_room_name_bytes),
    max_msg_body_bytes: normalizeRrcHubByteLimit(o.max_msg_body_bytes),
    max_rooms_per_session: normalizeRrcHubByteLimit(o.max_rooms_per_session),
    rate_limit_msgs_per_minute: normalizeRrcHubByteLimit(o.rate_limit_msgs_per_minute),
  };
}

/**
 * UTF-8 byte counter status for nick / room-name / body fields.
 * Counter hidden until ≥80% of the hub limit (same pattern as ChatComposer).
 */
export function computeRrcByteLimitStatus(
  text: string,
  limit: number | null | undefined,
): RrcByteLimitStatus | null {
  const max = normalizeRrcHubByteLimit(limit ?? null);
  if (max == null) return null;
  const byteCount = countMessageWireBytes(text);
  const showThreshold = Math.floor(max * 0.8);
  let phase: RrcByteLimitPhase = 'ok';
  if (byteCount > max) phase = 'overMax';
  else if (byteCount >= showThreshold) phase = 'warn';
  return { byteCount, limit: max, phase, showThreshold };
}

/**
 * Slash drafts (local/hub commands) bypass ChatComposer multi-part split so
 * `/join` / `/help` / `/nick` are never turned into `[1/N]` room spam.
 * Body-bearing slash commands (`/me`, `/msg`) are still validated against the
 * message body limit before send.
 */
export function rrcComposerBypassesSplit(raw: string): boolean {
  const text = raw.trim();
  if (!text.startsWith('/')) return false;
  const parsed = parseRrcSlashInput(text);
  return parsed != null && parsed.kind !== 'chat';
}

/**
 * Composer / field preflight rejection. RrcPanel rethrows these from handleSend
 * so ChatComposer’s onInterceptSend path keeps the draft and shows the message.
 */
export class RrcComposerPreflightError extends Error {
  override readonly name = 'RrcComposerPreflightError';
}

/** True when sidecar/hub rejected a body for exceeding WELCOME max_msg_body_bytes. */
export function isRrcHubMsgBodyLimitError(message: string): boolean {
  return /message exceeds hub limit/i.test(message);
}

/** True when sidecar/hub rejected a nickname for exceeding WELCOME max_nick_bytes. */
export function isRrcHubNickLimitError(message: string): boolean {
  return /nickname exceeds hub limit/i.test(message);
}
