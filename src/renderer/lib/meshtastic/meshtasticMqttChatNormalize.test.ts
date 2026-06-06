import { describe, expect, it, vi } from 'vitest';

import { normalizeMeshtasticMqttChatMessage } from './meshtasticMqttChatNormalize';

describe('normalizeMeshtasticMqttChatMessage', () => {
  it('normalizes broadcast to as undefined', () => {
    const msg = normalizeMeshtasticMqttChatMessage({
      sender_id: 0x12345678,
      sender_name: 'Alice',
      payload: 'hi',
      channel: 1,
      timestamp: 1_700_000_000_000,
      to: 0xffffffff,
    });
    expect(msg?.to).toBeUndefined();
  });

  it('preserves DM to addresses', () => {
    const msg = normalizeMeshtasticMqttChatMessage({
      sender_id: 0x12345678,
      sender_name: 'Alice',
      payload: 'dm',
      channel: 0,
      timestamp: 1_700_000_000_000,
      to: 0x87654321,
    });
    expect(msg?.to).toBe(0x87654321);
  });

  it('does not strip payload "0" when replyId is set', () => {
    const msg = normalizeMeshtasticMqttChatMessage({
      sender_id: 0x12345678,
      sender_name: 'Alice',
      payload: '0',
      channel: 0,
      timestamp: 1_700_000_000_000,
      replyId: 42,
      emoji: 1,
    });
    expect(msg?.payload).toBe('0');
  });

  it('returns null and warns on invalid sender_id', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(normalizeMeshtasticMqttChatMessage({ sender_id: 0, payload: 'x', timestamp: 1 })).toBe(
      null,
    );
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
