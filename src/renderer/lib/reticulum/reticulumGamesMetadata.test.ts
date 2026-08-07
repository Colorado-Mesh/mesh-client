import { describe, expect, it } from 'vitest';

import {
  gamesDrawOfferedBy,
  isGamesDrawOfferFromOpponent,
  isGamesDrawOfferFromSelf,
} from './reticulumGamesMetadata';

describe('gamesDrawOfferedBy', () => {
  it('reads draw_offered_by from metadata', () => {
    expect(gamesDrawOfferedBy({ draw_offered_by: 'abc' })).toBe('abc');
  });

  it('returns empty when missing or non-string', () => {
    expect(gamesDrawOfferedBy(undefined)).toBe('');
    expect(gamesDrawOfferedBy({})).toBe('');
    expect(gamesDrawOfferedBy({ draw_offered_by: 1 })).toBe('');
    expect(gamesDrawOfferedBy({ draw_offered_by: null })).toBe('');
    expect(gamesDrawOfferedBy({ draw_offered_by: '' })).toBe('');
  });
});

describe('isGamesDrawOfferFromSelf / isGamesDrawOfferFromOpponent', () => {
  it.each([
    {
      name: 'no pending draw',
      session: { identity_id: 'me', metadata: { draw_offered: false } },
      self: false,
      opponent: false,
    },
    {
      name: 'draw_offered absent',
      session: { identity_id: 'me', metadata: {} },
      self: false,
      opponent: false,
    },
    {
      name: 'metadata undefined',
      session: { identity_id: 'me' },
      self: false,
      opponent: false,
    },
    {
      name: 'stale owner without draw_offered flag',
      session: {
        identity_id: 'me',
        metadata: { draw_offered: false, draw_offered_by: 'me' },
      },
      self: false,
      opponent: false,
    },
    {
      name: 'string truthy draw_offered is ignored',
      session: {
        identity_id: 'me',
        metadata: { draw_offered: 'true', draw_offered_by: 'peer' },
      },
      self: false,
      opponent: false,
    },
    {
      name: 'self owner',
      session: {
        identity_id: 'me',
        metadata: { draw_offered: true, draw_offered_by: 'me' },
      },
      self: true,
      opponent: false,
    },
    {
      name: 'peer owner',
      session: {
        identity_id: 'me',
        metadata: { draw_offered: true, draw_offered_by: 'peer' },
      },
      self: false,
      opponent: true,
    },
    {
      name: 'missing draw_offered_by (legacy)',
      session: {
        identity_id: 'me',
        metadata: { draw_offered: true },
      },
      self: false,
      opponent: true,
    },
    {
      name: 'empty draw_offered_by (legacy)',
      session: {
        identity_id: 'me',
        metadata: { draw_offered: true, draw_offered_by: '' },
      },
      self: false,
      opponent: true,
    },
    {
      name: 'empty local identity_id cannot be self',
      session: {
        identity_id: '',
        metadata: { draw_offered: true, draw_offered_by: 'me' },
      },
      self: false,
      opponent: true,
    },
  ])('$name', ({ session, self, opponent }) => {
    expect(isGamesDrawOfferFromSelf(session)).toBe(self);
    expect(isGamesDrawOfferFromOpponent(session)).toBe(opponent);
  });
});
