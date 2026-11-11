import { describe, expect, it } from 'vitest';

import {
  MESHCORE_DB_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT,
  MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT,
} from './meshcoreMessageHydration';

describe('meshcoreMessageHydration', () => {
  it('exposes the documented hydration window limits', () => {
    expect(MESHCORE_DB_MESSAGE_LOAD_LIMIT).toBe(500);
    expect(MESHCORE_DB_ROOM_MESSAGE_LOAD_LIMIT).toBe(200);
    expect(MESHCORE_DB_PER_CHANNEL_MESSAGE_LOAD_LIMIT).toBe(100);
  });
});
