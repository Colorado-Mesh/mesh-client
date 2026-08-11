import { describe, expect, it } from 'vitest';

import { RRC_HUB_STREAM_ROOM } from '@/renderer/stores/rrcSessionStore';

import {
  parseRrcWhisperEcho,
  resolveRrcInboundChatRoom,
  RRC_UNSCOPED_NOTICE_ROOM,
  shouldDisplayRrcChatMessage,
  shouldDropEmptyRrcInbound,
  shouldShowRrcWhoTranscript,
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

describe('resolveRrcInboundChatRoom', () => {
  it('keeps room-scoped envelopes in that room', () => {
    expect(resolveRrcInboundChatRoom('general')).toBe('general');
    expect(resolveRrcInboundChatRoom('  #lobby  ')).toBe('#lobby');
  });

  it('routes empty K_ROOM to [hub], not the focused chat room', () => {
    expect(resolveRrcInboundChatRoom('')).toBe(RRC_HUB_STREAM_ROOM);
    expect(resolveRrcInboundChatRoom(null)).toBe(RRC_HUB_STREAM_ROOM);
    expect(resolveRrcInboundChatRoom(undefined)).toBe(RRC_HUB_STREAM_ROOM);
    expect(RRC_UNSCOPED_NOTICE_ROOM).toBe(RRC_HUB_STREAM_ROOM);
  });
});

describe('shouldShowRrcWhoTranscript', () => {
  it('allows the first /who snapshot per room and hides later ones', () => {
    const shown = new Set<string>();
    expect(shouldShowRrcWhoTranscript(shown, 'general')).toBe(true);
    shown.add('general');
    expect(shouldShowRrcWhoTranscript(shown, 'general')).toBe(false);
    expect(shouldShowRrcWhoTranscript(shown, '#general')).toBe(false);
    expect(shouldShowRrcWhoTranscript(shown, 'lobby')).toBe(true);
  });

  it('never shows synthetic or DM rooms as /who transcript lines', () => {
    expect(shouldShowRrcWhoTranscript(new Set(), '[hub]')).toBe(false);
    expect(shouldShowRrcWhoTranscript(new Set(), '@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
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
