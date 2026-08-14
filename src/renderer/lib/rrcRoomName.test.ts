import { describe, expect, it } from 'vitest';

import {
  normalizeRrcRoomName,
  resolveRrcJoinRoomName,
  resolveRrcWhoTranscriptForceRoom,
  rrcRoomMatchKey,
  rrcRoomsMatch,
  rrcWhoCommandToken,
  rrcWhoNoticeJoinedRoom,
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

describe('rrcWhoCommandToken', () => {
  it('returns a bare room token and rejects injection', () => {
    expect(rrcWhoCommandToken('#General')).toBe('general');
    expect(rrcWhoCommandToken('general')).toBe('general');
    expect(rrcWhoCommandToken('[hub]')).toBeNull();
    expect(rrcWhoCommandToken('@alice')).toBeNull();
    expect(rrcWhoCommandToken('gen eral')).toBeNull();
    expect(rrcWhoCommandToken('general/extra')).toBeNull();
    expect(rrcWhoCommandToken('')).toBeNull();
  });

  it('maps a /who NOTICE onto a joined room only', () => {
    expect(rrcWhoNoticeJoinedRoom('#General', ['general', 'lobby'])).toBe('general');
    expect(rrcWhoNoticeJoinedRoom('evil', ['general'])).toBeNull();
    expect(rrcWhoNoticeJoinedRoom('[hub]', ['[hub]'])).toBeNull();
  });
});

describe('resolveRrcWhoTranscriptForceRoom', () => {
  it('uses the /who argument when it matches a joined room', () => {
    expect(resolveRrcWhoTranscriptForceRoom('/who lobby', 'general', ['general', 'lobby'])).toBe(
      'lobby',
    );
    expect(resolveRrcWhoTranscriptForceRoom('/who #Lobby', 'general', ['general', 'lobby'])).toBe(
      'lobby',
    );
  });

  it('falls back to the focused joined room for bare /who', () => {
    expect(resolveRrcWhoTranscriptForceRoom('/who', 'general', ['general', 'lobby'])).toBe(
      'general',
    );
    expect(resolveRrcWhoTranscriptForceRoom('/who', '[hub]', ['general'])).toBeNull();
    expect(resolveRrcWhoTranscriptForceRoom('/who evil', 'general', ['general'])).toBeNull();
  });
});
