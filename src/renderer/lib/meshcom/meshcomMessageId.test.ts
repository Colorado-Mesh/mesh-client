import { describe, expect, it } from 'vitest';

import { meshcomIncomingStoreId } from './meshcomMessageId';

const base = {
  id: '1',
  from: 10,
  payload: 'hello',
  channelIndex: 0,
  timestamp: 1_000,
};

describe('meshcomIncomingStoreId', () => {
  it('keeps the wire id for a new or identical message', () => {
    expect(meshcomIncomingStoreId({}, base)).toBe('1');
    expect(meshcomIncomingStoreId({ '1': base }, base)).toBe('1');
  });

  it('mints a new id when sender or text differs', () => {
    expect(meshcomIncomingStoreId({ '1': base }, { ...base, from: 99, payload: 'other' })).toBe(
      '1~1000',
    );
    expect(
      meshcomIncomingStoreId(
        { '1': base, '1~1000': { ...base, from: 99, payload: 'other' } },
        { ...base, from: 7, payload: 'third' },
      ),
    ).toBe('1~1000~7');
  });
});
