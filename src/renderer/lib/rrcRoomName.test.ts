import { describe, expect, it } from 'vitest';

import {
  normalizeRrcRoomName,
  resolveRrcJoinRoomName,
  rrcRoomMatchKey,
  rrcRoomsMatch,
} from './rrcRoomName';

describe('rrcRoomMatchKey', () => {
  it('collapses optional leading hashes for IRC-style names', () => {
    expect(rrcRoomMatchKey('#General')).toBe('general');
    expect(rrcRoomMatchKey('##general')).toBe('general');
    expect(rrcRoomMatchKey('general')).toBe('general');
  });

  it('leaves synthetic and @ targets alone', () => {
    expect(rrcRoomMatchKey('[hub]')).toBe('[hub]');
    expect(rrcRoomMatchKey('@alice')).toBe('@alice');
  });
});

describe('rrcRoomsMatch', () => {
  it('treats #general and general as the same channel', () => {
    expect(rrcRoomsMatch('#general', 'general')).toBe(true);
    expect(rrcRoomsMatch('#ops', '#general')).toBe(false);
  });
});

describe('resolveRrcJoinRoomName', () => {
  it('prefers joined spelling, then listed, then bare name', () => {
    expect(
      resolveRrcJoinRoomName('#general', {
        joined: [{ name: 'general' }],
        listed: [{ name: '#general' }],
      }),
    ).toBe('general');
    expect(
      resolveRrcJoinRoomName('#lobby', {
        listed: [{ name: 'lobby' }],
      }),
    ).toBe('lobby');
    expect(resolveRrcJoinRoomName('#ops')).toBe('ops');
  });

  it('preserves normalizeRrcRoomName for exact wire form when needed', () => {
    expect(normalizeRrcRoomName('  #Lobby ')).toBe('#lobby');
  });
});
