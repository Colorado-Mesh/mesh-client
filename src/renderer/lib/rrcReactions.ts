import { firstGraphemeCluster, isReactionPickerEmojiGlyph } from '@/renderer/lib/reactions';
import { isRrcDmRoom } from '@/renderer/lib/rrcDmRoom';
import type { RrcChatMessage } from '@/shared/rrc-types';

/** rrc-extensions.md `K_REACT_OP` value that removes a reaction. */
export const RRC_REACT_OP_RETRACT = 1;

/** One reactor's emoji under a target line, in first-applied order (same shape as Chat chips). */
export interface RrcReactionRow {
  emoji: string;
  /** Reactor identity hash (K_SRC, hub-verified), lowercased; empty when the hub sent none. */
  senderHash: string;
  nickname: string | null;
  /** Wire id of the reaction line that applied it. */
  id: string;
}

export interface RrcReactionPartition {
  /** Transcript lines with every reaction line removed. */
  lines: RrcChatMessage[];
  /** Live reactions keyed by the lowercased wire id of the target line. */
  reactionsByTarget: ReadonlyMap<string, readonly RrcReactionRow[]>;
}

const WIRE_ID = /^[0-9a-f]{16}$/;

function normalizeWireId(id: string | null | undefined): string | null {
  const value = id?.trim().toLowerCase() ?? '';
  return WIRE_ID.test(value) ? value : null;
}

/** NFC single grapheme that reads as an emoji (rrc-extensions.md §2); null otherwise. */
export function rrcReactionGlyph(body: string): string | null {
  const glyph = firstGraphemeCluster(body.normalize('NFC'));
  return glyph && isReactionPickerEmojiGlyph(glyph) ? glyph : null;
}

function reactorKey(msg: RrcChatMessage): string | null {
  const hash = msg.sender_hash?.trim().toLowerCase();
  if (hash) return hash;
  const nick = msg.nickname?.trim().toLowerCase();
  return nick ? `nick:${nick}` : null;
}

/**
 * Split a room's messages into transcript lines and per-target reaction rows.
 * Apply and retract are idempotent (spec §2); a reaction whose target is not held in this
 * room, or whose body is not one emoji, is dropped rather than shown (spec §3).
 */
export function partitionRrcReactions(messages: readonly RrcChatMessage[]): RrcReactionPartition {
  const lines: RrcChatMessage[] = [];
  const reactionLines: RrcChatMessage[] = [];
  for (const msg of messages) {
    if (msg.react_to) reactionLines.push(msg);
    else lines.push(msg);
  }
  if (reactionLines.length === 0) return { lines, reactionsByTarget: new Map() };

  const heldTargets = new Set<string>();
  for (const line of lines) {
    const id = normalizeWireId(line.id);
    if (id) heldTargets.add(id);
  }

  // target -> reactor+emoji key -> row; Map keeps first-applied order.
  const byTarget = new Map<string, Map<string, RrcReactionRow>>();
  for (const msg of reactionLines) {
    const target = normalizeWireId(msg.react_to);
    if (!target || !heldTargets.has(target)) continue;
    const emoji = rrcReactionGlyph(msg.body);
    const reactor = reactorKey(msg);
    if (!emoji || !reactor) continue;
    const rows = byTarget.get(target) ?? new Map<string, RrcReactionRow>();
    const key = `${reactor}|${emoji}`;
    if (msg.react_op === RRC_REACT_OP_RETRACT) {
      rows.delete(key);
    } else if (!rows.has(key)) {
      rows.set(key, {
        emoji,
        senderHash: msg.sender_hash?.trim().toLowerCase() ?? '',
        nickname: msg.nickname?.trim() || null,
        id: msg.id,
      });
    }
    byTarget.set(target, rows);
  }

  const reactionsByTarget = new Map<string, RrcReactionRow[]>();
  for (const [target, rows] of byTarget) {
    if (rows.size > 0) reactionsByTarget.set(target, [...rows.values()]);
  }
  return { lines, reactionsByTarget };
}

/** Live reaction rows for one transcript line. */
export function rrcReactionsFor(
  partition: RrcReactionPartition,
  msg: Pick<RrcChatMessage, 'id'>,
): readonly RrcReactionRow[] {
  const id = normalizeWireId(msg.id);
  if (!id) return [];
  return partition.reactionsByTarget.get(id) ?? [];
}

/**
 * Lines a reaction can target: room chat and DM lines that carry a hub-relayed wire id.
 * Hub notices, local system rows and lines echoed before the id was known cannot be referenced.
 * DM lines rehydrated from SQLite have no `dst_hash`, so the `@hash` room marks them.
 */
export function canReactToRrcMessage(
  msg: Pick<RrcChatMessage, 'id' | 'kind' | 'room' | 'dst_hash' | 'react_to'>,
): boolean {
  if (msg.react_to || !normalizeWireId(msg.id)) return false;
  if (msg.kind === 'msg' || msg.kind === 'action') return true;
  return msg.kind === 'notice' && (Boolean(msg.dst_hash) || isRrcDmRoom(msg.room));
}
