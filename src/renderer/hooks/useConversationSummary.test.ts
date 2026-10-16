import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshcoreChatStubNodeIdFromDisplayName } from '@/renderer/lib/meshcoreUtils';
import { isWeatherPost } from '@/renderer/lib/weatherPosts';
import { disposeAiSummaries, useAiSummaryStore } from '@/renderer/stores/aiSummaryStore';
import {
  AI_MAX_TOTAL_CHARS,
  type AiProviderStatus,
  type AiSummaryMessage,
} from '@/shared/ai-types';

import { useConversationSummary } from './useConversationSummary';

const ready: AiProviderStatus = {
  enabled: true,
  engine: 'local',
  wireFormat: 'openai',
  baseUrl: 'http://127.0.0.1:1234',
  model: 'test',
  hasApiKey: false,
  timeoutSeconds: 60,
  allowRemote: false,
  isRemote: false,
  localEngine: { ready: false, modelId: null, downloading: false },
  osAi: { available: false, platform: null },
};
const input = {
  key: 'one',
  label: 'chat',
  protocol: 'meshcore' as const,
  surface: 'channel' as const,
  messages: [],
  watermark: 0,
  history: { protocol: 'meshcore' as const, surface: 'channel' as const, channel: 0 },
};
beforeEach(() => {
  vi.mocked(window.electronAPI.ai.summarize).mockClear();
  disposeAiSummaries();
  useAiSummaryStore.getState().setStatus(ready);
  vi.mocked(window.electronAPI.ai.summarize).mockResolvedValue({ ok: true });
});
describe('conversation summary async boundaries', () => {
  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'keeps older eligible %s messages when the newest exceeds the renderer limit',
    async (protocol) => {
      const older = { at: 1, sender: 'Alice', body: 'Net at 20:00.' };
      const { result } = renderHook(() =>
        useConversationSummary({
          ...input,
          protocol,
          history: null,
          messages: [older, { at: 2, sender: 'Bob', body: 'x'.repeat(AI_MAX_TOTAL_CHARS + 1) }],
        }),
      );
      await act(async () => {
        await result.current.run();
      });
      expect(window.electronAPI.ai.summarize).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [older] }),
      );
      expect(result.current.state).toMatchObject({ collectedMessageCount: 2, truncated: true });
    },
  );

  it('normalizes legacy MeshCore names and payloads before weather filtering and overlap merging', async () => {
    vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce([
      { at: 1, sender: 'WX', senderId: null, body: 'Morning report' },
      { at: 2, sender: 'Unknown', senderId: 0, body: 'WX: Still reporting' },
      { at: 3, sender: 'Custom Bot', senderId: 9, body: 'Custom Bot: CUSTOMWX report' },
      { at: 4, sender: 'Json Bot', senderId: 10, body: 'Json Bot: {"xiaomi1":{"temp":"66.7"}}' },
      { at: 5, sender: 'WX', senderId: 8, body: 'WX: Ordinary check-in' },
      { at: 6, sender: 'Alice', senderId: 2, body: 'Re: Meet at 12:30' },
    ]);
    const config = {
      customPattern: /^CUSTOMWX/i,
      markedSenders: new Set([meshcoreChatStubNodeIdFromDisplayName('WX')]),
    };
    const visible = { at: 5, sender: 'WX', body: 'Ordinary check-in' };
    const { result } = renderHook(() =>
      useConversationSummary({
        ...input,
        messages: [visible],
        includeHistoryMessage: (message) =>
          !isWeatherPost({ sender_id: message.senderId ?? -1, payload: message.body }, config),
      }),
    );
    await act(async () => {
      await result.current.run();
    });
    const messages = vi.mocked(window.electronAPI.ai.summarize).mock.calls[0][0].messages;
    expect(messages).toMatchObject([
      visible,
      { at: 6, sender: 'Alice', body: 'Re: Meet at 12:30' },
    ]);
    expect(messages).toHaveLength(2);
    expect(result.current.state?.collectedMessageCount).toBe(2);
  });

  it('filters fetched history before counting and bounding while retaining raw-query truncation', async () => {
    const hidden = Array.from({ length: 500 }, (_, at) => ({
      at: at + 2,
      sender: 'Weather',
      body: 'hidden',
    }));
    const visible = { at: 1, sender: 'Alice', body: 'East repeater is online.' };
    vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce([visible, ...hidden]);
    const { result } = renderHook(() =>
      useConversationSummary({
        ...input,
        includeHistoryMessage: (message) => message.body !== 'hidden',
      }),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(window.electronAPI.ai.summarize).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [visible] }),
    );
    expect(result.current.state).toMatchObject({ collectedMessageCount: 1, truncated: true });
  });

  it('skips inference when the fetched range contains only filtered messages', async () => {
    vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce([
      { at: 1, sender: 'Weather', body: 'hidden' },
    ]);
    const { result } = renderHook(() =>
      useConversationSummary({ ...input, includeHistoryMessage: () => false }),
    );
    await act(async () => {
      await result.current.run();
    });
    expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
    expect(result.current.state).toMatchObject({ collectedMessageCount: 0, error: 'noMessages' });
  });

  it.each(['meshtastic', 'meshcore', 'reticulum'] as const)(
    'keeps 44 distinct %s messages when three share text and timestamps',
    async (protocol) => {
      const messages = Array.from({ length: 41 }, (_, at) => ({
        at: at + 1,
        sender: 'Alice',
        body: `Message ${at}`,
      }));
      messages.push(...messages.slice(0, 3));
      vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce(messages);
      vi.mocked(window.electronAPI.ai.summarize).mockResolvedValueOnce({
        ok: true,
        summaryInput: { messageCount: 41, truncated: true },
      });
      const { result, rerender } = renderHook(
        ({ messages }) => useConversationSummary({ ...input, protocol, messages }),
        { initialProps: { messages } },
      );
      await act(async () => {
        await result.current.run();
      });
      expect(vi.mocked(window.electronAPI.ai.summarize).mock.calls[0][0].messages).toHaveLength(44);
      expect(result.current.state).toMatchObject({
        messageCount: 41,
        collectedMessageCount: 44,
        truncated: true,
      });
      rerender({ messages: [...messages, { at: 100, sender: 'Bob', body: 'New arrival' }] });
      expect(result.current.state?.collectedMessageCount).toBe(44);
    },
  );

  it('preserves the opening unread boundary and excludes older fetched history', async () => {
    vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce([
      { at: 100, sender: 'Alice', body: 'read' },
      { at: 200, sender: 'Bob', body: 'unread' },
    ]);
    const { result } = renderHook(() => useConversationSummary({ ...input, watermark: 100 }));
    await act(async () => {
      await result.current.run();
    });
    expect(window.electronAPI.ai.summarize).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ at: 200, sender: 'Bob', body: 'unread' }],
        scope: { kind: 'unread' },
      }),
    );
  });
  it('cancels history loading promptly and ignores a late failure after dismiss', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(window.electronAPI.ai.getHistory).mockReturnValueOnce(
      new Promise((_resolve, r) => {
        reject = r;
      }),
    );
    const { result } = renderHook(() => useConversationSummary(input));
    let running!: Promise<void>;
    act(() => {
      running = result.current.run();
    });
    expect(result.current.pending).toBe(true);
    act(() => {
      result.current.dismiss();
    });
    expect(result.current.pending).toBe(false);
    await act(async () => {
      reject(new Error('history failed'));
      await running;
    });
    expect(useAiSummaryStore.getState().summaries.one).toBeUndefined();
  });
  it('does not let an old conversation fetch block or populate another conversation', async () => {
    let resolve!: (messages: AiSummaryMessage[]) => void;
    vi.mocked(window.electronAPI.ai.getHistory).mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const { result, rerender } = renderHook(
      ({ key }) => useConversationSummary({ ...input, key }),
      { initialProps: { key: 'one' } },
    );
    let running!: Promise<void>;
    act(() => {
      running = result.current.run();
    });
    rerender({ key: 'two' });
    expect(result.current.pending).toBe(false);
    rerender({ key: 'one' });
    expect(result.current.pending).toBe(false);
    await act(async () => {
      resolve([{ at: 1, sender: 'old', body: 'old' }]);
      await running;
    });
    expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
  });
});
