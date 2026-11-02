import { describe, expect, it } from 'vitest';

import type { RrcChatMessage } from '@/shared/rrc-types';

import {
  canReactToRrcMessage,
  partitionRrcReactions,
  RRC_REACT_OP_RETRACT,
  rrcReactionGlyph,
  rrcReactionsFor,
} from './rrcReactions';

const ALICE = 'aa'.repeat(16);
const BOB = 'bb'.repeat(16);
const TARGET_ID = '1111111111111111';

let seq = 0;
function line(overrides: Partial<RrcChatMessage> = {}): RrcChatMessage {
  seq += 1;
  return {
    id: seq.toString(16).padStart(16, '0'),
    room: 'lobby',
    kind: 'msg',
    body: 'hello',
    sender_hash: ALICE,
    nickname: 'alice',
    timestamp: 1_000 + seq,
    ...overrides,
  };
}

function reaction(emoji: string, overrides: Partial<RrcChatMessage> = {}): RrcChatMessage {
  return line({
    body: emoji,
    react_to: TARGET_ID,
    sender_hash: BOB,
    nickname: 'bob',
    ...overrides,
  });
}

const target = () => line({ id: TARGET_ID, body: 'ship it?' });

describe('partitionRrcReactions', () => {
  it('moves reaction lines out of the transcript and onto their target', () => {
    const partition = partitionRrcReactions([target(), reaction('👍')]);
    expect(partition.lines.map((m) => m.body)).toEqual(['ship it?']);
    expect(rrcReactionsFor(partition, { id: TARGET_ID })).toMatchObject([
      { emoji: '👍', senderHash: BOB, nickname: 'bob' },
    ]);
  });

  it('applies the same reactor and emoji once, and keeps each reactor', () => {
    const partition = partitionRrcReactions([
      target(),
      reaction('👍'),
      reaction('👍'),
      reaction('👍', { sender_hash: ALICE, nickname: 'alice' }),
      reaction('🎉'),
    ]);
    expect(
      rrcReactionsFor(partition, { id: TARGET_ID }).map((r) => `${r.nickname}:${r.emoji}`),
    ).toEqual(['bob:👍', 'alice:👍', 'bob:🎉']);
  });

  it('retracts idempotently and lets a later apply restore it', () => {
    const retract = { react_op: RRC_REACT_OP_RETRACT };
    const removed = partitionRrcReactions([
      target(),
      reaction('👍', retract),
      reaction('👍'),
      reaction('👍', retract),
      reaction('👍', retract),
    ]);
    expect(rrcReactionsFor(removed, { id: TARGET_ID })).toEqual([]);
    expect(removed.reactionsByTarget.size).toBe(0);

    const restored = partitionRrcReactions([
      target(),
      reaction('👍'),
      reaction('👍', retract),
      reaction('👍'),
    ]);
    expect(rrcReactionsFor(restored, { id: TARGET_ID })).toHaveLength(1);
  });

  it('drops reactions whose target is not held in this room', () => {
    const partition = partitionRrcReactions([
      target(),
      reaction('👍', { react_to: 'ffffffffffffffff' }),
    ]);
    expect(partition.lines).toHaveLength(1);
    expect(partition.reactionsByTarget.size).toBe(0);
  });

  it('never attaches a reaction to another reaction', () => {
    const first = reaction('👍');
    const partition = partitionRrcReactions([
      target(),
      first,
      reaction('🎉', { react_to: first.id }),
    ]);
    expect(rrcReactionsFor(partition, { id: TARGET_ID }).map((r) => r.emoji)).toEqual(['👍']);
    expect(rrcReactionsFor(partition, { id: first.id })).toEqual([]);
  });

  it('drops bodies that are not a single emoji', () => {
    const partition = partitionRrcReactions([
      target(),
      reaction('nice'),
      reaction('👍👍'),
      reaction(''),
    ]);
    expect(partition.lines).toHaveLength(1);
    expect(partition.reactionsByTarget.size).toBe(0);
  });

  it('matches target ids case-insensitively', () => {
    const partition = partitionRrcReactions([
      target(),
      reaction('👍', { react_to: TARGET_ID.toUpperCase() }),
    ]);
    expect(rrcReactionsFor(partition, { id: TARGET_ID.toUpperCase() })).toHaveLength(1);
  });

  it('falls back to the nickname when the hub sent no sender hash', () => {
    const partition = partitionRrcReactions([
      target(),
      reaction('👍', { sender_hash: null }),
      reaction('👍', { sender_hash: null }),
    ]);
    expect(rrcReactionsFor(partition, { id: TARGET_ID })).toMatchObject([
      { emoji: '👍', senderHash: '', nickname: 'bob' },
    ]);
  });
});

describe('rrcReactionGlyph', () => {
  it('accepts one emoji grapheme, modifiers and flags included', () => {
    expect(rrcReactionGlyph('👍')).toBe('👍');
    expect(rrcReactionGlyph(' 👍🏽 ')).toBe('👍🏽');
    expect(rrcReactionGlyph('🇺🇸')).toBe('🇺🇸');
  });

  it('rejects text, several graphemes and blanks', () => {
    expect(rrcReactionGlyph('a')).toBeNull();
    expect(rrcReactionGlyph('👍 ok')).toBeNull();
    expect(rrcReactionGlyph('   ')).toBeNull();
  });
});

describe('canReactToRrcMessage', () => {
  it('allows room chat, actions and DM lines with a wire id', () => {
    expect(canReactToRrcMessage(line())).toBe(true);
    expect(canReactToRrcMessage(line({ kind: 'action' }))).toBe(true);
    expect(canReactToRrcMessage(line({ kind: 'notice', dst_hash: ALICE }))).toBe(true);
    // Rehydrated DM rows have no dst_hash; the @hash room still marks them as DM lines.
    expect(canReactToRrcMessage(line({ kind: 'notice', room: `@${ALICE}` }))).toBe(true);
  });

  it('refuses hub notices, local rows, synthetic ids and reaction lines', () => {
    expect(canReactToRrcMessage(line({ kind: 'notice' }))).toBe(false);
    expect(canReactToRrcMessage(line({ kind: 'system' }))).toBe(false);
    expect(canReactToRrcMessage(line({ kind: 'error' }))).toBe(false);
    expect(canReactToRrcMessage(line({ id: 'whisper-out-1730000000000' }))).toBe(false);
    expect(canReactToRrcMessage(line({ react_to: TARGET_ID }))).toBe(false);
  });
});
