// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  GAMES_DRAW_CLAIM,
  isGamesApiPath,
  isGamesDeliveryInFlight,
  parseGamesActionRequest,
} from './games-types';

describe('games-types', () => {
  it('detects games API paths', () => {
    expect(isGamesApiPath('/api/v1/games/status')).toBe(true);
    expect(isGamesApiPath('/api/v1/games/sessions/abc/read')).toBe(true);
    expect(isGamesApiPath('/api/v1/games')).toBe(true);
    expect(isGamesApiPath('/api/v1/games/sessions?peer=abc')).toBe(true);
    expect(isGamesApiPath('/api/v1/voice/status')).toBe(false);
    expect(isGamesApiPath('/api/v1/gameshow')).toBe(false);
  });

  it('exports stable draw-claim reason codes', () => {
    expect(GAMES_DRAW_CLAIM.THREEFOLD).toBe('3fr');
    expect(GAMES_DRAW_CLAIM.FIFTY_MOVE).toBe('50m');
  });

  it('detects in-flight delivery states', () => {
    expect(isGamesDeliveryInFlight('pending')).toBe(true);
    expect(isGamesDeliveryInFlight('sending')).toBe(true);
    expect(isGamesDeliveryInFlight('propagating')).toBe(true);
    expect(isGamesDeliveryInFlight('failed')).toBe(false);
    expect(isGamesDeliveryInFlight(undefined)).toBe(false);
  });

  it('parses valid game actions', () => {
    const parsed = parseGamesActionRequest({
      dest_hash: 'aabbccddeeff00112233445566778899',
      app_id: 'ttt',
      command: 'challenge',
      session_id: 'abcdef0123456789',
      payload: { i: 4 },
    });
    expect(parsed).toEqual({
      dest_hash: 'aabbccddeeff00112233445566778899',
      app_id: 'ttt',
      command: 'challenge',
      session_id: 'abcdef0123456789',
      payload: { i: 4 },
    });
  });

  it('rejects invalid game actions', () => {
    expect(parseGamesActionRequest(null)).toEqual({ error: 'invalid_game_action' });
    expect(parseGamesActionRequest({ app_id: 'ttt', command: 'move' })).toEqual({
      error: 'invalid_dest_hash',
    });
    expect(parseGamesActionRequest({ dest_hash: 'aa', command: 'move' })).toEqual({
      error: 'invalid_app_id',
    });
    expect(parseGamesActionRequest({ dest_hash: 'aa', app_id: 'ttt' })).toEqual({
      error: 'invalid_command',
    });
  });
});
