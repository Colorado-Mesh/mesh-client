import { describe, expect, it } from 'vitest';

import { MS_PER_MINUTE } from '@/shared/timeConstants';

import {
  createRollCall,
  isRollCallExpired,
  isRollCallOkReply,
  noteRollCallReply,
  rollCallMissing,
  tallyRollCallReplies,
} from './rollCall';

const T0 = 1_700_000_000_000;

describe('tallyRollCallReplies', () => {
  it('counts OK replies inside the window, skips own/early/non-OK, normalizes seconds', () => {
    const state = createRollCall(['1', '2', '3', '4'], 15, T0);
    const out = tallyRollCallReplies(
      state,
      [
        { sender_id: 1, payload: 'OK', timestamp: T0 + 1000 },
        { sender_id: 2, payload: 'ok thanks', timestamp: (T0 + 2000) / 1000 },
        { sender_id: 3, payload: 'OK', timestamp: T0 - 1000 },
        { sender_id: 4, payload: 'where?', timestamp: T0 + 1000 },
        { sender_id: 9, payload: 'OK', timestamp: T0 + 1000 },
      ],
      (id) => id === 9,
    );
    expect(out.respondedPeerIds).toEqual(['1', '2']);
    expect(rollCallMissing(out)).toEqual(['3', '4']);
  });

  it('returns the same state when nothing matches', () => {
    const state = createRollCall(['1'], 15, T0);
    expect(tallyRollCallReplies(state, [], () => false)).toBe(state);
  });
});

describe('createRollCall', () => {
  it('uses defaults and dedupes expected peers', () => {
    const state = createRollCall(['a', 'b', 'a'], undefined, T0);
    expect(state).toEqual({
      startedAt: T0,
      windowMinutes: 15,
      expectedPeerIds: ['a', 'b'],
      respondedPeerIds: [],
      commandText: 'Roll call: reply OK',
    });
  });

  it('falls back to the default window for invalid values', () => {
    expect(createRollCall([], 0, T0).windowMinutes).toBe(15);
    expect(createRollCall([], NaN, T0).windowMinutes).toBe(15);
    expect(createRollCall([], 5, T0).windowMinutes).toBe(5);
  });
});

describe('isRollCallOkReply', () => {
  it.each(['OK', 'ok', 'Ok thanks', ' OK ', 'MECP/3/L15 OK', 'MECP/3/L15 OK 40.00000,-105.00000'])(
    'accepts %s',
    (text) => {
      expect(isRollCallOkReply(text)).toBe(true);
    },
  );

  it.each(['okay', 'not ok', 'Need help', '', 'MECP/3/C01 Need help'])('rejects %s', (text) => {
    expect(isRollCallOkReply(text)).toBe(false);
  });
});

describe('noteRollCallReply', () => {
  it('records OK replies within the window and dedupes by peer', () => {
    let state = createRollCall(['a', 'b', 'c'], 15, T0);
    state = noteRollCallReply(state, 'a', 'OK', T0 + 1000);
    const again = noteRollCallReply(state, 'a', 'ok', T0 + 2000);
    expect(again).toBe(state);
    state = noteRollCallReply(state, 'b', 'ok here', T0 + 3000);
    expect(state.respondedPeerIds).toEqual(['a', 'b']);
    expect(rollCallMissing(state)).toEqual(['c']);
  });

  it('ignores non-OK replies', () => {
    const state = createRollCall(['a'], 15, T0);
    expect(noteRollCallReply(state, 'a', 'Need help', T0 + 1)).toBe(state);
  });

  it('ignores replies outside the window', () => {
    const state = createRollCall(['a'], 15, T0);
    expect(noteRollCallReply(state, 'a', 'OK', T0 - 1)).toBe(state);
    expect(noteRollCallReply(state, 'a', 'OK', T0 + 15 * MS_PER_MINUTE + 1)).toBe(state);
    expect(noteRollCallReply(state, 'a', 'OK', T0 + 15 * MS_PER_MINUTE).respondedPeerIds).toEqual([
      'a',
    ]);
  });

  it('counts unexpected responders without listing them as missing', () => {
    const state = noteRollCallReply(createRollCall(['a'], 15, T0), 'z', 'OK', T0 + 1);
    expect(state.respondedPeerIds).toEqual(['z']);
    expect(rollCallMissing(state)).toEqual(['a']);
  });
});

describe('isRollCallExpired', () => {
  it('expires after the window', () => {
    const state = createRollCall([], 10, T0);
    expect(isRollCallExpired(state, T0 + 10 * MS_PER_MINUTE)).toBe(false);
    expect(isRollCallExpired(state, T0 + 10 * MS_PER_MINUTE + 1)).toBe(true);
  });
});
