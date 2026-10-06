/**
 * Display-only grouping of repetitive hub notices in an RRC room stream.
 * Every reconnect replays WELCOME greeting, join-acks, `/list`, `/who`, and
 * link-proof timeouts; runs of those collapse into one expandable row.
 */

import { rrcErrorToI18nKey } from '@/renderer/lib/rrcErrorHumanize';
import {
  isRrcJoinInfoNotice,
  parseRrcListNotice,
  parseRrcTopicNotice,
  parseRrcWhoNotice,
} from '@/renderer/lib/rrcNoticeParsers';
import type { RrcChatMessage } from '@/shared/rrc-types';

/** Smallest run that collapses; a lone banner between chat lines stays inline. */
export const RRC_NOTICE_GROUP_MIN_RUN = 2;

export interface RrcNoticeGroup {
  /** Stable across appends: id of the first row in the run. */
  id: string;
  messages: RrcChatMessage[];
  /** Latest topic from a join-ack / topic notice in the run. */
  topic: string | null;
  /** Member count from the latest `/who` notice in the run. */
  memberCount: number | null;
  linkTimeoutCount: number;
}

export type RrcDisplayRow =
  { type: 'message'; msg: RrcChatMessage } | { type: 'group'; group: RrcNoticeGroup };

type HubNoticeMessage = Pick<
  RrcChatMessage,
  'kind' | 'body' | 'nickname' | 'dst_hash' | 'sender_hash'
>;

/**
 * Hub reconnect greeting ("Welcome to <hub>.").
 * Other welcome lines, such as "Welcome, you are muted", stay as their own rows.
 */
const HUB_GREETING_LINE = /^welcome to\b/i;

/** Empty sender, or the connected hub. Other hashes are peers, even with no nick. */
function senderIsConnectedHub(
  senderHash: string | null | undefined,
  hubHash: string | null | undefined,
): boolean {
  const sender = senderHash?.trim() ?? '';
  if (!sender) return true;
  const hub = hubHash?.trim() ?? '';
  if (!hub) return false;
  return sender.toLowerCase() === hub.toLowerCase();
}

/** Hub-originated (not a whisper) notice/system/error row. */
function isHubAuthoredNotice(msg: HubNoticeMessage, hubHash: string | null | undefined): boolean {
  if (msg.kind !== 'notice' && msg.kind !== 'system' && msg.kind !== 'error') return false;
  if (!senderIsConnectedHub(msg.sender_hash, hubHash)) return false;
  // Hub notices carry the hub's sender_hash but no nick; whispers carry a nick and/or K_DST.
  return !msg.nickname?.trim() && !msg.dst_hash?.trim();
}

function isLinkProofTimeout(msg: HubNoticeMessage): boolean {
  return msg.kind === 'error' && rrcErrorToI18nKey(msg.body) === 'rrc.errors.linkProofTimeout';
}

/** True for hub session banners replayed on every (re)connect. */
export function isRrcHubSessionBanner(
  msg: HubNoticeMessage,
  hubHash: string | null | undefined,
): boolean {
  if (!isHubAuthoredNotice(msg, hubHash)) return false;
  if (isLinkProofTimeout(msg)) return true;
  if (msg.kind !== 'notice') return false;
  const text = msg.body.trim();
  if (!text) return false;
  if (HUB_GREETING_LINE.test(text)) return true;
  if (isRrcJoinInfoNotice(text)) return true;
  if (parseRrcWhoNotice(text)) return true;
  return parseRrcListNotice(msg.body) !== null;
}

function canJoinRun(
  prev: RrcChatMessage,
  next: RrcChatMessage,
  hubHash: string | null | undefined,
): boolean {
  if (isRrcHubSessionBanner(prev, hubHash) && isRrcHubSessionBanner(next, hubHash)) return true;
  return (
    isHubAuthoredNotice(prev, hubHash) &&
    isHubAuthoredNotice(next, hubHash) &&
    prev.kind === next.kind &&
    prev.body.trim() === next.body.trim()
  );
}

function summarizeRun(run: RrcChatMessage[]): RrcNoticeGroup {
  let topic: string | null = null;
  let memberCount: number | null = null;
  let linkTimeoutCount = 0;
  for (const msg of run) {
    if (isLinkProofTimeout(msg)) {
      linkTimeoutCount += 1;
      continue;
    }
    if (msg.kind !== 'notice') continue;
    const parsedTopic = parseRrcTopicNotice(msg.body);
    if (parsedTopic) topic = parsedTopic.topic || null;
    const who = parseRrcWhoNotice(msg.body);
    if (who) memberCount = who.members.length;
  }
  return { id: run[0].id, messages: run, topic, memberCount, linkTimeoutCount };
}

/**
 * Collapse runs of consecutive hub session banners (and identical repeated
 * hub notices) into groups. Order is preserved; chat rows are never grouped.
 */
export function groupRrcNoticeRows(
  messages: readonly RrcChatMessage[],
  hubHash: string | null | undefined,
): RrcDisplayRow[] {
  const rows: RrcDisplayRow[] = [];
  let run: RrcChatMessage[] = [];

  const flush = () => {
    if (run.length >= RRC_NOTICE_GROUP_MIN_RUN) {
      rows.push({ type: 'group', group: summarizeRun(run) });
    } else {
      for (const msg of run) rows.push({ type: 'message', msg });
    }
    run = [];
  };

  for (const msg of messages) {
    const prev = run.length > 0 ? run[run.length - 1] : undefined;
    if (prev && canJoinRun(prev, msg, hubHash)) {
      run.push(msg);
      continue;
    }
    flush();
    if (isHubAuthoredNotice(msg, hubHash)) {
      run.push(msg);
    } else {
      rows.push({ type: 'message', msg });
    }
  }
  flush();
  return rows;
}

/**
 * Expansion is keyed by member message ids (not group id) so it survives the
 * first row being trimmed from the window or a run splitting and re-forming.
 */
export function isRrcNoticeGroupExpanded(
  group: RrcNoticeGroup,
  expandedMessageIds: ReadonlySet<string>,
): boolean {
  return group.messages.some((msg) => expandedMessageIds.has(msg.id));
}

export function toggleRrcNoticeGroupExpansion(
  expandedMessageIds: ReadonlySet<string>,
  group: RrcNoticeGroup,
): ReadonlySet<string> {
  const next = new Set(expandedMessageIds);
  if (isRrcNoticeGroupExpanded(group, expandedMessageIds)) {
    for (const msg of group.messages) next.delete(msg.id);
  } else {
    for (const msg of group.messages) next.add(msg.id);
  }
  return next;
}

/** Drop markers for messages no longer inside a group; returns the same set when unchanged. */
export function pruneRrcExpandedNoticeIds(
  expandedMessageIds: ReadonlySet<string>,
  rows: readonly RrcDisplayRow[],
): ReadonlySet<string> {
  if (expandedMessageIds.size === 0) return expandedMessageIds;
  const grouped = new Set<string>();
  for (const row of rows) {
    if (row.type !== 'group') continue;
    for (const msg of row.group.messages) grouped.add(msg.id);
  }
  let changed = false;
  const next = new Set<string>();
  for (const id of expandedMessageIds) {
    if (grouped.has(id)) next.add(id);
    else changed = true;
  }
  return changed ? next : expandedMessageIds;
}
