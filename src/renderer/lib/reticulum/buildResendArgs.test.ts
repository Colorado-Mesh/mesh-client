import { describe, expect, it } from 'vitest';

import { buildResendArgs } from './buildResendArgs';

describe('buildResendArgs', () => {
  it('maps payload, channel and destination', () => {
    expect(buildResendArgs({ payload: 'hi', channel: 2, to: 7 })).toMatchObject({
      text: 'hi',
      channelIndex: 2,
      destination: 7,
    });
  });

  it('normalizes a null destination to undefined', () => {
    expect(buildResendArgs({ payload: 'hi', channel: 0, to: null }).destination).toBeUndefined();
  });

  it('prefers the reticulum reply hash over a numeric replyId', () => {
    expect(
      buildResendArgs({
        payload: 'hi',
        channel: 0,
        replyId: 5,
        reticulum_reply_to_hash: 'abc',
      }).replyTo,
    ).toBe('abc');
  });

  it('stringifies a numeric replyId when there is no reticulum reply hash', () => {
    expect(buildResendArgs({ payload: 'hi', channel: 0, replyId: 5 }).replyTo).toBe('5');
  });

  it('leaves replyTo undefined when neither is present', () => {
    expect(buildResendArgs({ payload: 'hi', channel: 0 }).replyTo).toBeUndefined();
  });

  it('prefers the reticulum message hash as retryOfStoreId so the prior row is rekeyed', () => {
    expect(
      buildResendArgs({
        payload: 'hi',
        channel: 0,
        reticulum_message_hash: 'hash-1',
        storeId: 'store-1',
      }).retryOfStoreId,
    ).toBe('hash-1');
  });

  it('falls back to storeId for non-reticulum rows', () => {
    expect(buildResendArgs({ payload: 'hi', channel: 0, storeId: 'store-1' }).retryOfStoreId).toBe(
      'store-1',
    );
  });
});
