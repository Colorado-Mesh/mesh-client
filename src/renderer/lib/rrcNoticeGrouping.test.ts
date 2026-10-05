import { describe, expect, it } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import { groupRrcNoticeRows, isRrcHubSessionBanner } from './rrcNoticeGrouping';

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
    expect(isRrcHubSessionBanner(notice(WELCOME))).toBe(true);
    expect(isRrcHubSessionBanner(notice(JOIN_ACK))).toBe(true);
    expect(isRrcHubSessionBanner(notice(LIST))).toBe(true);
    expect(isRrcHubSessionBanner(notice(WHO))).toBe(true);
    expect(isRrcHubSessionBanner(notice(LINK_PROOF, { kind: 'error', sender_hash: null }))).toBe(
      true,
    );
  });

  it('rejects whispers, chat, and unrelated hub notices', () => {
    expect(isRrcHubSessionBanner(notice(WELCOME, { nickname: 'Alice' }))).toBe(false);
    expect(isRrcHubSessionBanner(notice(JOIN_ACK, { dst_hash: 'ab'.repeat(16) }))).toBe(false);
    expect(isRrcHubSessionBanner(chat(WELCOME))).toBe(false);
    expect(isRrcHubSessionBanner(notice('You have been kicked from general'))).toBe(false);
    expect(isRrcHubSessionBanner(notice(LINK_PROOF))).toBe(false);
  });
});

describe('groupRrcNoticeRows', () => {
  it('collapses a reconnect burst and summarizes topic and members', () => {
    const msgs = [chat('Morning!'), notice(WELCOME), notice(JOIN_ACK), notice(WHO), chat('hi')];
    const rows = groupRrcNoticeRows(msgs);
    expect(rows.map((r) => r.type)).toEqual(['message', 'group', 'message']);
    const group = rows[1].type === 'group' ? rows[1].group : null;
    expect(group?.id).toBe(msgs[1].id);
    expect(group?.messages).toHaveLength(3);
    expect(group?.topic).toBe('https://coloradomesh.org/ - Everyone is welcome!');
    expect(group?.memberCount).toBe(3);
    expect(group?.linkTimeoutCount).toBe(0);
  });

  it('keeps a lone banner inline', () => {
    const rows = groupRrcNoticeRows([chat('a'), notice(JOIN_ACK), chat('b')]);
    expect(rows.every((r) => r.type === 'message')).toBe(true);
  });

  it('counts repeated link-proof timeouts in one group', () => {
    const err = (): RrcChatMessage =>
      notice(LINK_PROOF, { kind: 'error', sender_hash: null, room: '[hub]' });
    const rows = groupRrcNoticeRows([err(), err(), err(), notice(WELCOME)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type === 'group' && rows[0].group.linkTimeoutCount).toBe(3);
  });

  it('collapses identical repeated non-banner hub notices', () => {
    const missing = 'No member list from the hub for general.';
    const sys = (): RrcChatMessage => notice(missing, { kind: 'system', sender_hash: null });
    const rows = groupRrcNoticeRows([sys(), sys()]);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe('group');
  });

  it('never groups whispers between banners', () => {
    const whisper = notice('psst', { nickname: 'Alice' });
    const rows = groupRrcNoticeRows([notice(JOIN_ACK), whisper, notice(JOIN_ACK)]);
    expect(rows.map((r) => r.type)).toEqual(['message', 'message', 'message']);
  });

  it('keeps group id stable when the run grows', () => {
    const first = notice(WELCOME);
    const base = [first, notice(JOIN_ACK)];
    const before = groupRrcNoticeRows(base);
    const after = groupRrcNoticeRows([...base, notice(WHO)]);
    expect(before[0].type === 'group' && before[0].group.id).toBe(first.id);
    expect(after[0].type === 'group' && after[0].group.id).toBe(first.id);
  });
});
