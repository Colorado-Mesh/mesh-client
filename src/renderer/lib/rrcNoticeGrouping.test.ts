import { describe, expect, it } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import {
  groupRrcNoticeRows,
  isRrcHubSessionBanner,
  isRrcNoticeGroupExpanded,
  pruneRrcExpandedNoticeIds,
  type RrcDisplayRow,
  type RrcNoticeGroup,
  toggleRrcNoticeGroupExpansion,
} from './rrcNoticeGrouping';

const HUB = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
let seq = 0;

function notice(body: string, extra: Partial<RrcChatMessage> = {}): RrcChatMessage {
  seq += 1;
  return {
    id: `n${seq}`,
    room: 'general',
    kind: 'notice',
    body,
    sender_hash: HUB,
    nickname: null,
    timestamp: seq * 1000,
    ...extra,
  };
}

function chat(body: string, nickname = 'Zeva'): RrcChatMessage {
  seq += 1;
  return {
    id: `m${seq}`,
    room: 'general',
    kind: 'msg',
    body,
    sender_hash: 'ff'.repeat(16),
    nickname,
    timestamp: seq * 1000,
  };
}

const WELCOME = 'Welcome to the Colorado Mesh RRC hub.';
const JOIN_ACK =
  'room general: registered; mode=+r; topic=https://coloradomesh.org/ - Everyone is welcome!';
const LIST =
  'Registered public rooms:\n  general - https://coloradomesh.org/ - Everyone is welcome!';
const WHO =
  'members in general: x0thrm (30ad6f69ebac), iDEN-Laptop (7c494ab06144), w0rmt (57f88d42e2e4)';
const LINK_PROOF = 'timed out waiting for link proof';

describe('isRrcHubSessionBanner', () => {
  it('recognizes reconnect banners from the hub', () => {
    expect(isRrcHubSessionBanner(notice(WELCOME), HUB)).toBe(true);
    expect(isRrcHubSessionBanner(notice(JOIN_ACK), HUB)).toBe(true);
    expect(isRrcHubSessionBanner(notice(LIST), HUB)).toBe(true);
    expect(isRrcHubSessionBanner(notice(WHO), HUB)).toBe(true);
    expect(
      isRrcHubSessionBanner(notice(LINK_PROOF, { kind: 'error', sender_hash: null }), HUB),
    ).toBe(true);
  });

  it('rejects whispers, chat, and unrelated hub notices', () => {
    expect(isRrcHubSessionBanner(notice(WELCOME, { nickname: 'Alice' }), HUB)).toBe(false);
    expect(isRrcHubSessionBanner(notice(JOIN_ACK, { dst_hash: 'ab'.repeat(16) }), HUB)).toBe(false);
    expect(isRrcHubSessionBanner(chat(WELCOME), HUB)).toBe(false);
    expect(isRrcHubSessionBanner(notice('You have been kicked from general'), HUB)).toBe(false);
    expect(isRrcHubSessionBanner(notice(LINK_PROOF), HUB)).toBe(false);
  });

  it('leaves other welcome lines as ordinary notices', () => {
    expect(isRrcHubSessionBanner(notice('Welcome, you are muted'), HUB)).toBe(false);
    expect(isRrcHubSessionBanner(notice('Welcome back'), HUB)).toBe(false);
  });

  it('requires an empty sender or the connected hub hash', () => {
    const peer = 'cd'.repeat(16);
    expect(isRrcHubSessionBanner(notice(WELCOME, { sender_hash: peer }), HUB)).toBe(false);
    expect(isRrcHubSessionBanner(notice(WELCOME, { sender_hash: HUB.toUpperCase() }), HUB)).toBe(
      true,
    );
    expect(isRrcHubSessionBanner(notice(WELCOME, { sender_hash: '' }), HUB)).toBe(true);
    expect(isRrcHubSessionBanner(notice(WELCOME, { sender_hash: null }), null)).toBe(true);
    expect(isRrcHubSessionBanner(notice(WELCOME), null)).toBe(false);
  });
});

describe('groupRrcNoticeRows', () => {
  it('collapses a reconnect burst and summarizes topic and members', () => {
    const msgs = [chat('Morning!'), notice(WELCOME), notice(JOIN_ACK), notice(WHO), chat('hi')];
    const rows = groupRrcNoticeRows(msgs, HUB);
    expect(rows.map((r) => r.type)).toEqual(['message', 'group', 'message']);
    const group = rows[1].type === 'group' ? rows[1].group : null;
    expect(group?.id).toBe(msgs[1].id);
    expect(group?.messages).toHaveLength(3);
    expect(group?.topic).toBe('https://coloradomesh.org/ - Everyone is welcome!');
    expect(group?.memberCount).toBe(3);
    expect(group?.linkTimeoutCount).toBe(0);
  });

  it('keeps a lone banner inline', () => {
    const rows = groupRrcNoticeRows([chat('a'), notice(JOIN_ACK), chat('b')], HUB);
    expect(rows.every((r) => r.type === 'message')).toBe(true);
  });

  it('counts repeated link-proof timeouts in one group', () => {
    const err = (): RrcChatMessage =>
      notice(LINK_PROOF, { kind: 'error', sender_hash: null, room: '[hub]' });
    const rows = groupRrcNoticeRows([err(), err(), err(), notice(WELCOME)], HUB);
    expect(rows).toHaveLength(1);
    expect(rows[0].type === 'group' && rows[0].group.linkTimeoutCount).toBe(3);
  });

  it('collapses identical repeated non-banner hub notices', () => {
    const missing = 'No member list from the hub for general.';
    const sys = (): RrcChatMessage => notice(missing, { kind: 'system', sender_hash: null });
    const rows = groupRrcNoticeRows([sys(), sys()], HUB);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('group');
  });

  it('never groups whispers between banners', () => {
    const whisper = notice('psst', { nickname: 'Alice' });
    const rows = groupRrcNoticeRows([notice(JOIN_ACK), whisper, notice(JOIN_ACK)], HUB);
    expect(rows.map((r) => r.type)).toEqual(['message', 'message', 'message']);
  });

  it('keeps a non-greeting welcome line as its own row', () => {
    const muted = notice('Welcome, you are muted');
    const rows = groupRrcNoticeRows([notice(WELCOME), muted, notice(JOIN_ACK)], HUB);
    expect(rows.map((r) => r.type)).toEqual(['message', 'message', 'message']);
    expect(rows[1]).toEqual({ type: 'message', msg: muted });
  });

  it('does not treat a peer-authored greeting as a hub banner', () => {
    const peer = notice(WELCOME, { sender_hash: 'cd'.repeat(16) });
    const rows = groupRrcNoticeRows([peer, notice(JOIN_ACK), notice(WHO)], HUB);
    expect(rows[0]).toEqual({ type: 'message', msg: peer });
    expect(rows.map((r) => r.type)).toEqual(['message', 'group']);
  });

  it('keeps group id stable when the run grows', () => {
    const first = notice(WELCOME);
    const base = [first, notice(JOIN_ACK)];
    const before = groupRrcNoticeRows(base, HUB);
    const after = groupRrcNoticeRows([...base, notice(WHO)], HUB);
    expect(before[0].type === 'group' && before[0].group.id).toBe(first.id);
    expect(after[0].type === 'group' && after[0].group.id).toBe(first.id);
  });
});

describe('notice group expansion', () => {
  function firstGroup(rows: RrcDisplayRow[]): RrcNoticeGroup {
    const row = rows.find((r) => r.type === 'group');
    if (row?.type !== 'group') throw new Error('expected a group');
    return row.group;
  }

  it('toggles by member message ids', () => {
    const group = firstGroup(groupRrcNoticeRows([notice(WELCOME), notice(JOIN_ACK)], HUB));
    const expanded = toggleRrcNoticeGroupExpansion(new Set(), group);
    expect(isRrcNoticeGroupExpanded(group, expanded)).toBe(true);
    const collapsed = toggleRrcNoticeGroupExpansion(expanded, group);
    expect(isRrcNoticeGroupExpanded(group, collapsed)).toBe(false);
    expect(collapsed.size).toBe(0);
  });

  it('stays expanded when the first message is trimmed from the window', () => {
    const msgs = [notice(WELCOME), notice(JOIN_ACK), notice(WHO)];
    const expanded = toggleRrcNoticeGroupExpansion(
      new Set(),
      firstGroup(groupRrcNoticeRows(msgs, HUB)),
    );
    const trimmedRows = groupRrcNoticeRows(msgs.slice(1), HUB);
    const pruned = pruneRrcExpandedNoticeIds(expanded, trimmedRows);
    expect(isRrcNoticeGroupExpanded(firstGroup(trimmedRows), pruned)).toBe(true);
    expect(pruned.has(msgs[0].id)).toBe(false);
  });

  it('prunes markers once messages are no longer grouped', () => {
    const msgs = [notice(WELCOME), notice(JOIN_ACK)];
    const expanded = toggleRrcNoticeGroupExpansion(
      new Set(),
      firstGroup(groupRrcNoticeRows(msgs, HUB)),
    );
    const pruned = pruneRrcExpandedNoticeIds(expanded, groupRrcNoticeRows(msgs.slice(1), HUB));
    expect(pruned.size).toBe(0);
  });

  it('returns the same set when nothing is pruned', () => {
    const rows = groupRrcNoticeRows([notice(WELCOME), notice(JOIN_ACK)], HUB);
    const expanded = toggleRrcNoticeGroupExpansion(new Set(), firstGroup(rows));
    expect(pruneRrcExpandedNoticeIds(expanded, rows)).toBe(expanded);
  });
});
