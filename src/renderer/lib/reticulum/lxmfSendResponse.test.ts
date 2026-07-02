import { describe, expect, it } from 'vitest';

import { extractLxmfPayloadFromSendResponse } from './lxmfSendResponse';

describe('extractLxmfPayloadFromSendResponse', () => {
  const payload = {
    sender_hash: 'aa'.repeat(16),
    text: 'hello',
    message_hash: 'bb'.repeat(16),
  };

  it('returns flat message payload', () => {
    expect(extractLxmfPayloadFromSendResponse({ ok: true, message: payload })).toEqual(payload);
  });

  it('unwraps double-nested live sidecar shape', () => {
    expect(
      extractLxmfPayloadFromSendResponse({
        ok: true,
        message: { ok: true, message: payload, sent_via: 'network' },
      }),
    ).toEqual(payload);
  });

  it('returns null when message is missing or invalid', () => {
    expect(extractLxmfPayloadFromSendResponse({ ok: true })).toBeNull();
    expect(extractLxmfPayloadFromSendResponse(null)).toBeNull();
    expect(extractLxmfPayloadFromSendResponse({ ok: true, message: { foo: 'bar' } })).toBeNull();
  });
});
