import { describe, expect, it } from 'vitest';

import { MAX_IN_MEMORY_CHAT_MESSAGES } from './chatInMemoryBuffer';
import {
  MAX_MESHCORE_MEMORY_CHANNELS,
  type MeshcoreMemoryWindowFields,
  trimMeshcoreChatMessages,
  trimMeshcoreMemoryWindow,
} from './meshcoreMessageMemoryWindow';
import { loadRuntimeSource } from './sourceContractTestHelpers';
import type { ChatMessage } from './types';

function fields(
  partial: Partial<MeshcoreMemoryWindowFields> & Pick<MeshcoreMemoryWindowFields, 'trimId'>,
): MeshcoreMemoryWindowFields {
  return {
    timestamp: 0,
    channelIndex: 0,
    to: 0,
    ...partial,
  };
}

function chat(
  partial: Partial<ChatMessage> & Pick<ChatMessage, 'channel' | 'timestamp'>,
): ChatMessage {
  return {
    sender_id: 1,
    sender_name: 'A',
    payload: 'm',
    status: 'acked',
    ...partial,
  };
}

describe('trimMeshcoreMemoryWindow', () => {
  it('returns the same array at or under the cap', () => {
    const items = [fields({ trimId: 'a', timestamp: 1 })];
    expect(trimMeshcoreMemoryWindow(items, (item) => item, 10)).toBe(items);
  });

  it('keeps quiet-channel floors when the fair set exceeds the global cap', () => {
    const items: MeshcoreMemoryWindowFields[] = [];
    for (let channel = 0; channel < 21; channel++) {
      for (let i = 0; i < 100; i++) {
        items.push(
          fields({
            trimId: `${channel}-${i}`,
            channelIndex: channel,
            timestamp: channel * 1_000 + i,
          }),
        );
      }
    }
    expect(items).toHaveLength(2100);
    const kept = trimMeshcoreMemoryWindow(items, (item) => item, MAX_IN_MEMORY_CHAT_MESSAGES);
    expect(kept.length).toBeGreaterThan(MAX_IN_MEMORY_CHAT_MESSAGES);
    const quiet = kept.filter((item) => item.channelIndex === 0);
    expect(quiet).toHaveLength(100);
    expect(quiet.some((item) => item.trimId === '0-0')).toBe(true);
  });

  it('drops the oldest surplus on one busy channel down to the cap', () => {
    const items = Array.from({ length: 2500 }, (_, i) =>
      fields({ trimId: `p-${i}`, channelIndex: 0, timestamp: i + 1 }),
    );
    const kept = trimMeshcoreMemoryWindow(items, (item) => item, 2000);
    expect(kept).toHaveLength(2000);
    expect(kept[0]?.trimId).toBe('p-500');
    expect(kept[kept.length - 1]?.trimId).toBe('p-2499');
  });

  it('always keeps rows that are still sending', () => {
    const items = [
      fields({ trimId: 'sending', timestamp: 1, status: 'sending' }),
      ...Array.from({ length: 150 }, (_, i) =>
        fields({ trimId: `n-${i}`, channelIndex: 0, timestamp: i + 10 }),
      ),
    ];
    const kept = trimMeshcoreMemoryWindow(items, (item) => item, 100);
    expect(kept.some((item) => item.trimId === 'sending')).toBe(true);
    expect(kept).toHaveLength(101);
  });

  it('bounds distinct logical channels', () => {
    const items: MeshcoreMemoryWindowFields[] = [];
    const channels = MAX_MESHCORE_MEMORY_CHANNELS + 1;
    for (let channel = 0; channel < channels; channel++) {
      for (let i = 0; i < 100; i++) {
        items.push(
          fields({
            trimId: `${channel}-${i}`,
            channelIndex: channel,
            timestamp: channel * 1_000 + i,
          }),
        );
      }
    }
    const kept = trimMeshcoreMemoryWindow(items, (item) => item, MAX_IN_MEMORY_CHAT_MESSAGES);
    expect(kept.some((item) => item.channelIndex === 0)).toBe(false);
    expect(kept.filter((item) => item.channelIndex === channels - 1)).toHaveLength(100);
    expect(kept.length).toBeLessThanOrEqual(MAX_MESHCORE_MEMORY_CHANNELS * 100);
  });
});

describe('trimMeshcoreChatMessages', () => {
  it('keeps a quiet ChatMessage channel in a replace-style sorted list', () => {
    const messages: ChatMessage[] = [];
    for (let channel = 0; channel < 21; channel++) {
      for (let i = 0; i < 100; i++) {
        messages.push(
          chat({
            id: channel * 100 + i,
            channel,
            timestamp: channel * 1_000 + i,
            payload: `${channel}-${i}`,
          }),
        );
      }
    }
    const kept = trimMeshcoreChatMessages(messages);
    expect(kept.filter((message) => message.channel === 0)).toHaveLength(100);
    expect(kept.some((message) => message.payload === '0-0')).toBe(true);
  });

  it('keeps a quiet channel when a live or optimistic row is appended past the cap', () => {
    const prev: ChatMessage[] = [];
    for (let channel = 0; channel < 21; channel++) {
      for (let i = 0; i < 100; i++) {
        prev.push(
          chat({
            id: channel * 100 + i,
            channel,
            timestamp: channel * 1_000 + i,
            payload: `ch${channel}-${i}`,
          }),
        );
      }
    }
    const live = trimMeshcoreChatMessages([
      ...prev,
      chat({ id: 90000, channel: 20, timestamp: 999_999, payload: 'live' }),
    ]);
    const temp = trimMeshcoreChatMessages([
      ...prev,
      chat({
        channel: -1,
        timestamp: 999_999,
        payload: 'temp',
        status: 'sending',
        to: 42,
      }),
    ]);
    expect(live.filter((message) => message.channel === 0)).toHaveLength(100);
    expect(live.some((message) => message.payload === 'live')).toBe(true);
    expect(temp.filter((message) => message.channel === 0)).toHaveLength(100);
    expect(temp.some((message) => message.payload === 'temp')).toBe(true);
  });
});

describe('useMeshcoreRuntime message trim', () => {
  it('uses the fair MeshCore window for live ingest and optimistic sends', () => {
    const source = loadRuntimeSource('useMeshcoreRuntime.ts');
    expect(source).toContain('trimMeshcoreChatMessages');
    expect(source).not.toContain('trimChatMessagesToMax');
  });
});
