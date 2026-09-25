import { MS_PER_MINUTE } from '@/shared/timeConstants';

import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { QUICK_STATUS_OK_TEXT } from './quickStatusMessages';

export interface RollCallState {
  startedAt: number;
  windowMinutes: number;
  expectedPeerIds: string[];
  respondedPeerIds: string[];
  commandText: string;
}

export const DEFAULT_ROLL_CALL_WINDOW_MINUTES = DEFAULT_APP_SETTINGS_SHARED.rollCallWindowMinutes;
export const ROLL_CALL_COMMAND_TEXT = 'Roll call: reply OK';

const OK_REPLY_REGEX = /^ok\b/i;
const MECP_PREFIX_REGEX = /^MECP\/[0-3]\//;
const MECP_CODE_REGEX = /^[A-Z]\d{2}$/;

/** Quick-status MECP OK (`MECP/<sev>/L15 OK …`) should count as a reply too. */
function stripMecpPrefix(text: string): string {
  if (!MECP_PREFIX_REGEX.test(text)) return text;
  const words = text.replace(MECP_PREFIX_REGEX, '').split(/\s+/);
  let i = 0;
  while (i < words.length && MECP_CODE_REGEX.test(words[i])) i++;
  return words.slice(i).join(' ');
}

export function createRollCall(
  expectedPeerIds: string[],
  windowMinutes = DEFAULT_ROLL_CALL_WINDOW_MINUTES,
  now = Date.now(),
): RollCallState {
  const window =
    Number.isFinite(windowMinutes) && windowMinutes > 0
      ? windowMinutes
      : DEFAULT_ROLL_CALL_WINDOW_MINUTES;
  return {
    startedAt: now,
    windowMinutes: window,
    expectedPeerIds: [...new Set(expectedPeerIds)],
    respondedPeerIds: [],
    commandText: ROLL_CALL_COMMAND_TEXT,
  };
}

export function isRollCallOkReply(text: string): boolean {
  const trimmed = stripMecpPrefix(text.trim()).trim();
  return trimmed === QUICK_STATUS_OK_TEXT || OK_REPLY_REGEX.test(trimmed);
}

export function isRollCallExpired(state: RollCallState, now = Date.now()): boolean {
  return now > state.startedAt + state.windowMinutes * MS_PER_MINUTE;
}

/** Returns the same state object when the reply does not change the tally. */
export function noteRollCallReply(
  state: RollCallState,
  peerId: string,
  text: string,
  now = Date.now(),
): RollCallState {
  if (now < state.startedAt || isRollCallExpired(state, now)) return state;
  if (state.respondedPeerIds.includes(peerId)) return state;
  if (!isRollCallOkReply(text)) return state;
  return { ...state, respondedPeerIds: [...state.respondedPeerIds, peerId] };
}

export interface RollCallReplyCandidate {
  sender_id: number;
  payload: string;
  /** Unix ms (seconds are accepted and normalized). */
  timestamp: number;
}

const UNIX_SECONDS_CEILING = 1e12;

/** Fold chat messages into the roll-call tally; own messages never count as replies. */
export function tallyRollCallReplies(
  state: RollCallState,
  messages: readonly RollCallReplyCandidate[],
  isOwnNode: (nodeId: number) => boolean,
): RollCallState {
  let next = state;
  for (const m of messages) {
    if (isOwnNode(m.sender_id)) continue;
    const ts = m.timestamp < UNIX_SECONDS_CEILING ? m.timestamp * 1000 : m.timestamp;
    next = noteRollCallReply(next, String(m.sender_id), m.payload, ts);
  }
  return next;
}

export function rollCallMissing(state: RollCallState): string[] {
  const responded = new Set(state.respondedPeerIds);
  return state.expectedPeerIds.filter((id) => !responded.has(id));
}
