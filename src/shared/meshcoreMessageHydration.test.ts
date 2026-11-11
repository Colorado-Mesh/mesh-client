import { describe, expect, it } from 'vitest';

import {
  MESHCORE_DB_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
} from './meshcoreMessageHydration';

describe('meshcoreMessageHydration', () => {
  it.each([
    ['global DM window', MESHCORE_DB_MESSAGE_LOAD_LIMIT, 500],
    ['room BBS window', MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT, 200],
    ['per-channel window', MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT, 100],
  ] as const)('exposes the %s limit', (_label, actual, expected) => {
    expect(actual).toBe(expected);
  });
});
