import { describe, expect, it } from 'vitest';

import {
  parseRrcWhisperEcho,
  shouldDisplayRrcChatMessage,
  shouldDropEmptyRrcInbound,
} from './rrcMessageDisplay';

describe('shouldDisplayRrcChatMessage / shouldDropEmptyRrcInbound', () => {
  it('hides empty notice/system/error', () => {
    expect(shouldDisplayRrcChatMessage({ kind: 'notice', body: '' })).toBe(false);
    expect(shouldDisplayRrcChatMessage({ kind: 'system', body: '   ' })).toBe(false);
    expect(shouldDisplayRrcChatMessage({ kind: 'error', body: '\n' })).toBe(false);
    expect(shouldDropEmptyRrcInbound('notice', '')).toBe(true);
    expect(shouldDropEmptyRrcInbound('system', '  ')).toBe(true);
  });

  it('keeps non-empty notice and empty msg', () => {
    expect(shouldDisplayRrcChatMessage({ kind: 'notice', body: 'hi' })).toBe(true);
    expect(shouldDisplayRrcChatMessage({ kind: 'msg', body: '' })).toBe(true);
    expect(shouldDropEmptyRrcInbound('msg', '')).toBe(false);
    expect(shouldDropEmptyRrcInbound('action', '')).toBe(false);
  });
});

describe('parseRrcWhisperEcho', () => {
  it('parses → name: text', () => {
    expect(parseRrcWhisperEcho('→ Zeva: hello')).toEqual({ name: 'Zeva', text: 'hello' });
    expect(parseRrcWhisperEcho('→ nv0n: multi\nline')).toEqual({
      name: 'nv0n',
      text: 'multi\nline',
    });
  });

  it('returns null for non-echo bodies', () => {
    expect(parseRrcWhisperEcho('* joined')).toBeNull();
    expect(parseRrcWhisperEcho('hello')).toBeNull();
  });
});
