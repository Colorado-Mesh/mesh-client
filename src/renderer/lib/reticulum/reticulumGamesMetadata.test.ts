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
  });
});

describe('isGamesDrawOfferFromSelf / isGamesDrawOfferFromOpponent', () => {
  it('returns false for both when draw_offered is not set', () => {
    const session = { identity_id: 'me', metadata: { draw_offered: false } };
    expect(isGamesDrawOfferFromSelf(session)).toBe(false);
    expect(isGamesDrawOfferFromOpponent(session)).toBe(false);
  });

  it('treats self owner as self offer', () => {
    const session = {
      identity_id: 'me',
      metadata: { draw_offered: true, draw_offered_by: 'me' },
    };
    expect(isGamesDrawOfferFromSelf(session)).toBe(true);
    expect(isGamesDrawOfferFromOpponent(session)).toBe(false);
  });

  it('treats peer owner as opponent offer', () => {
    const session = {
      identity_id: 'me',
      metadata: { draw_offered: true, draw_offered_by: 'peer' },
    };
    expect(isGamesDrawOfferFromSelf(session)).toBe(false);
    expect(isGamesDrawOfferFromOpponent(session)).toBe(true);
  });

  it('treats missing draw_offered_by as opponent offer (legacy)', () => {
    const session = {
      identity_id: 'me',
      metadata: { draw_offered: true },
    };
    expect(isGamesDrawOfferFromSelf(session)).toBe(false);
    expect(isGamesDrawOfferFromOpponent(session)).toBe(true);
  });
});
