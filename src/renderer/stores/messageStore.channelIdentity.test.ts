import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Protocol } from '../lib/protocols/Protocol';
import { addIdentity, removeIdentity } from './identityStore';
import { resetLiveChannelKeyStoreForTests, setLiveChannelKeys } from './liveChannelKeyStore';
import {
  addMessage,
  type MessageRecord,
  remapMessageNodeId,
  upsertMessage,
  upsertMessageRecordsForIdentity,
  useMessageStore,
} from './messageStore';

const ID = 'identity-mc';
const KEY_A = 'aaaaaaaaaaaaaaaa';
const RADIO = 222;

function record(id: string, extra: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id,
    from: 1,
    to: 0xffffffff,
    payload: 'hello',
    channelIndex: 1,
    timestamp: 1,
    ...extra,
  };
}

function stored(id: string): MessageRecord | undefined {
  return useMessageStore.getState().messages[ID]?.[id];
}

describe.each(['meshcore', 'meshtastic'] as const)(
  'live channel identity stamping (%s)',
  (type) => {
    beforeEach(() => {
      useMessageStore.setState({ messages: {} });
      addIdentity({
        id: ID,
        protocol: { type } as unknown as Protocol,
        signature: '',
        transports: [],
        createdAt: 0,
        lastSeenAt: 0,
      });
      setLiveChannelKeys(type, { radioNodeId: RADIO, keyByIndex: { 1: KEY_A } });
    });

    afterEach(() => {
      removeIdentity(ID);
      resetLiveChannelKeyStoreForTests();
    });

    it('stamps live inserts with the connected radio and slot key', () => {
      addMessage(ID, record('a'));
      upsertMessage(ID, record('b'));
      for (const id of ['a', 'b']) {
        expect(stored(id)).toMatchObject({ radioNodeId: RADIO, channelKey: KEY_A });
      }
    });

    it('stamps only the radio on DMs', () => {
      addMessage(ID, record('dm', { to: 5 }));
      expect(stored('dm')?.radioNodeId).toBe(RADIO);
      expect(stored('dm')?.channelKey).toBeUndefined();
    });

    it('does not stamp bulk DB hydration rows', () => {
      upsertMessageRecordsForIdentity(ID, [record('db')]);
      expect(stored('db')?.channelKey).toBeUndefined();
      expect(stored('db')?.radioNodeId).toBeUndefined();
    });

    it('rewrites radioNodeId when the recording radio renumbers', () => {
      const oldNum = 111;
      const newNum = 222;
      upsertMessageRecordsForIdentity(ID, [
        record('heard', { from: 5, radioNodeId: oldNum }),
        record('sent', { from: oldNum, to: 9, radioNodeId: 9 }),
      ]);
      remapMessageNodeId(ID, oldNum, newNum);
      expect(stored('heard')).toMatchObject({ from: 5, radioNodeId: newNum });
      expect(stored('sent')).toMatchObject({ from: newNum, to: 9, radioNodeId: 9 });
    });

    it('keeps an existing identity when a full replace omits it', () => {
      addMessage(ID, record('a'));
      addMessage(ID, record('a', { payload: 'edited' }));
      expect(stored('a')).toMatchObject({
        payload: 'edited',
        channelKey: KEY_A,
        radioNodeId: RADIO,
      });
    });
  },
);
