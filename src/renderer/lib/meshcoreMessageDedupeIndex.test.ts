import { describe, expect, it } from 'vitest';

import { meshcoreMessageDedupeKey } from '../hooks/meshcore/meshcoreHookPreamble';
import {
  clearMeshcoreDedupeIndex,
  indexMeshcoreMessageForDedupe,
  lookupMeshcoreMessageIdByDedupeKey,
  meshcoreDedupeIndexSize,
  rebuildMeshcoreDedupeIndex,
} from './meshcoreMessageDedupeIndex';
import type { ChatMessage } from './types';

const IDENTITY = 'meshcore:test' as const;

function sampleMsg(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    sender_id: 1,
    sender_name: 'A',
    payload: 'hello',
    timestamp: 1_700_000_000_000,
    channel: 0,
    ...overrides,
  };
}

describe('meshcoreMessageDedupeIndex', () => {
  it('lookup is O(1) after indexMeshcoreMessageForDedupe', () => {
    clearMeshcoreDedupeIndex(IDENTITY);
    const msg = sampleMsg();
    const id = 'ch:0:1700000000';
    indexMeshcoreMessageForDedupe(IDENTITY, msg, id);
    expect(lookupMeshcoreMessageIdByDedupeKey(IDENTITY, meshcoreMessageDedupeKey(msg))).toBe(id);
    expect(meshcoreDedupeIndexSize(IDENTITY)).toBe(1);
  });

  it('rebuildMeshcoreDedupeIndex replaces bucket for identity', () => {
    clearMeshcoreDedupeIndex(IDENTITY);
    const a = sampleMsg({ payload: 'a' });
    const b = sampleMsg({ payload: 'b', timestamp: 1_700_000_001_000 });
    rebuildMeshcoreDedupeIndex(IDENTITY, [
      { id: 'id-a', message: a },
      { id: 'id-b', message: b },
    ]);
    expect(meshcoreDedupeIndexSize(IDENTITY)).toBe(2);
    expect(lookupMeshcoreMessageIdByDedupeKey(IDENTITY, meshcoreMessageDedupeKey(b))).toBe('id-b');
  });
});
