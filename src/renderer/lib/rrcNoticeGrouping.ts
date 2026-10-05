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

type HubNoticeMessage = Pick<RrcChatMessage, 'kind' | 'body' | 'nickname' | 'dst_hash'>;

/** Hub-originated (not a whisper) notice/system/error row. */
function isHubAuthoredNotice(msg: HubNoticeMessage): boolean {
  if (msg.kind !== 'notice' && msg.kind !== 'system' && msg.kind !== 'error') return false;
  // Hub notices carry the hub's sender_hash but no nick; whispers carry a nick and/or K_DST.
  return !msg.nickname?.trim() && !msg.dst_hash?.trim();
}

function isLinkProofTimeout(msg: HubNoticeMessage): boolean {
  return msg.kind === 'error' && rrcErrorToI18nKey(msg.body) === 'rrc.errors.linkProofTimeout';
}

/** True for hub session banners replayed on every (re)connect. */
export function isRrcHubSessionBanner(msg: HubNoticeMessage): boolean {
  if (!isHubAuthoredNotice(msg)) return false;
  if (isLinkProofTimeout(msg)) return true;
  if (msg.kind !== 'notice') return false;
  const text = msg.body.trim();
  if (!text) return false;
  if (/^welcome\b/i.test(text)) return true;
  if (isRrcJoinInfoNotice(text)) return true;
  if (parseRrcWhoNotice(text)) return true;
  return parseRrcListNotice(msg.body) !== null;
}

function canJoinRun(prev: RrcChatMessage, next: RrcChatMessage): boolean {
  if (isRrcHubSessionBanner(prev) && isRrcHubSessionBanner(next)) return true;
  return (
    isHubAuthoredNotice(prev) &&
    isHubAuthoredNotice(next) &&
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
export function groupRrcNoticeRows(messages: readonly RrcChatMessage[]): RrcDisplayRow[] {
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
    if (prev && canJoinRun(prev, msg)) {
      run.push(msg);
      continue;
    }
    flush();
    if (isHubAuthoredNotice(msg)) {
      run.push(msg);
    } else {
      rows.push({ type: 'message', msg });
    }
  }
  flush();
  return rows;
}
