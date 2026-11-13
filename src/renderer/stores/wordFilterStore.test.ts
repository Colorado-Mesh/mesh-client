import { beforeEach, describe, expect, it } from 'vitest';

import type { ChatMessage } from '../lib/types';
import {
  hydrateWordFilterPreferences,
  isHiddenByWordFilter,
  messageMatchesWordFilter,
  useWordFilterStore,
} from './wordFilterStore';

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, 'payload'>): ChatMessage {
  return {
    sender_id: 1,
    sender_name: 'A',
    channel: 0,
    timestamp: 1,
    ...partial,
  };
}

describe('wordFilterStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWordFilterStore.setState({
      enabled: false,
      words: [],
      disabledConversations: new Set(),
    });
  });

  it('matches case-insensitive substrings', () => {
    expect(messageMatchesWordFilter('Hello SPAM world', ['spam'])).toBe(true);
    expect(messageMatchesWordFilter('clean', ['spam'])).toBe(false);
  });

  it('hides matching channel messages when enabled', () => {
    useWordFilterStore.getState().setEnabled(true);
    useWordFilterStore.getState().setWordsText('spam,bad');
    expect(isHiddenByWordFilter(msg({ payload: 'this is SPAM' }), 'meshtastic')).toBe(true);
    expect(isHiddenByWordFilter(msg({ payload: 'hello' }), 'meshtastic')).toBe(false);
  });

  it('never filters MECP / MAYDAY / URGENT payloads', () => {
    useWordFilterStore.getState().setEnabled(true);
    useWordFilterStore.getState().setWordsText('urgent,mayday,mecp');
    expect(
      isHiddenByWordFilter(msg({ payload: 'MECP/0/M01 M07 P05 2pax 48.65,20.13' }), 'meshtastic'),
    ).toBe(false);
    expect(isHiddenByWordFilter(msg({ payload: 'MECP/1/M05' }), 'meshcore')).toBe(false);
  });

  it('respects per-conversation disable and hydrates', () => {
    useWordFilterStore.getState().setEnabled(true);
    useWordFilterStore.getState().setWordsText('spam');
    useWordFilterStore.getState().setConversationDisabled('ch:0', true);
    expect(isHiddenByWordFilter(msg({ payload: 'spam' }), 'meshtastic', 'ch:0')).toBe(false);
    hydrateWordFilterPreferences();
    expect(useWordFilterStore.getState().enabled).toBe(true);
    expect(useWordFilterStore.getState().words).toContain('spam');
    expect(useWordFilterStore.getState().disabledConversations.has('ch:0')).toBe(true);
  });
});
