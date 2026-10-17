import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshcoreChatStubNodeIdFromDisplayName } from '@/renderer/lib/meshcoreUtils';
import { isWeatherPost } from '@/renderer/lib/weatherPosts';
import { disposeAiSummaries, useAiSummaryStore } from '@/renderer/stores/aiSummaryStore';
import {
  AI_MAX_TOTAL_CHARS,
  type AiProviderStatus,
  type AiSummaryDone,
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
  vi.mocked(window.electronAPI.ai.getHistory).mockClear();
  vi.mocked(window.electronAPI.ai.cancel).mockResolvedValue(undefined);
  disposeAiSummaries();
  useAiSummaryStore.getState().setStatus(ready);
  let complete!: (value: AiSummaryDone) => void;
  vi.mocked(window.electronAPI.ai.onSummaryDone).mockImplementation((callback) => {
    complete = callback;
    return () => {};
  });
  vi.mocked(window.electronAPI.ai.summarize).mockImplementation((request) => {
    complete({
      requestId: request.requestId,
      text: 'Summary',
      provider: 'test',
      model: 'test',
      messageCount: request.messages.length,
      truncated: false,
    });
    return Promise.resolve({ ok: true });
  });
});
describe('Catch up availability', () => {
  const platforms = ['linux', 'darwin', 'win32'] as const;
  const protocols = ['meshtastic', 'meshcore', 'reticulum'] as const;
  it.each(platforms.flatMap((platform) => protocols.map((protocol) => ({ platform, protocol }))))(
    'keeps setup discoverable for $protocol on $platform after a missing or removed model',
    async ({ platform, protocol }) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      useAiSummaryStore.getState().setStatus({ ...ready, engine: 'bundled' });
      const { result } = renderHook(() => useConversationSummary({ ...input, protocol }));
      expect(result.current).toMatchObject({ showCatchUp: true, canSummarize: false });
      await act(async () => {
        await result.current.run();
      });
      expect(window.electronAPI.ai.getHistory).not.toHaveBeenCalled();
      expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();

      act(() => {
        useAiSummaryStore.getState().setStatus({
          ...ready,
          engine: 'bundled',
          localEngine: { ready: true, modelId: 'llama-3.2-1b', downloading: false },
        });
      });
      expect(result.current).toMatchObject({ showCatchUp: true, canSummarize: true });
      act(() => {
        useAiSummaryStore.getState().setStatus({ ...ready, enabled: false });
      });
      expect(result.current).toMatchObject({ showCatchUp: false, canSummarize: false });
    },
  );
  it.each(platforms.flatMap((platform) => protocols.map((protocol) => ({ platform, protocol }))))(
    'offers setup from saved opt-in while status is unavailable for $protocol on $platform',
    async ({ platform, protocol }) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      useAiSummaryStore.setState({ status: null, cachedEnabled: true });
      const { result } = renderHook(() => useConversationSummary({ ...input, protocol }));
      expect(result.current).toMatchObject({ showCatchUp: true, canSummarize: false });
      await act(async () => {
        await result.current.run();
      });
      expect(window.electronAPI.ai.getHistory).not.toHaveBeenCalled();
      expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
      act(() => {
        useAiSummaryStore.getState().setStatus({ ...ready, enabled: false });
      });
      expect(result.current).toMatchObject({ showCatchUp: false, canSummarize: false });
      act(() => {
        useAiSummaryStore.setState({ status: null, cachedEnabled: false });
      });
      expect(result.current).toMatchObject({ showCatchUp: false, canSummarize: false });
    },
  );
  it.each([
    { engine: null },
    { engine: 'local' as const, model: '' },
    { engine: 'remote' as const, baseUrl: '' },
  ])('offers setup for an incomplete configuration: %j', async (configuration) => {
    useAiSummaryStore.getState().setStatus({ ...ready, ...configuration });
    const { result, rerender } = renderHook(
      ({ available }) => useConversationSummary({ ...input, available }),
      { initialProps: { available: true } },
    );
    expect(result.current).toMatchObject({ showCatchUp: true, canSummarize: false });
    await act(async () => {
      await result.current.run();
    });
    expect(window.electronAPI.ai.getHistory).not.toHaveBeenCalled();
    expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
    rerender({ available: false });
    expect(result.current).toMatchObject({ showCatchUp: false, canSummarize: false });
  });
  it('does not query history through a stale ready callback after disable', async () => {
    const { result } = renderHook(() => useConversationSummary(input));
    const run = result.current.run;
    await act(async () => {
      useAiSummaryStore.getState().setStatus({ ...ready, enabled: false });
      await run();
    });
    expect(window.electronAPI.ai.getHistory).not.toHaveBeenCalled();
    expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
  });
  it.each(['reconfigure', 'disable and re-enable'])(
    'discards pending history after %s, including a switch back to the same status',
    async (change) => {
      let resolveHistory!: (messages: AiSummaryMessage[]) => void;
      vi.mocked(window.electronAPI.ai.getHistory).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
      );
      const { result } = renderHook(() => useConversationSummary(input));
      let running!: Promise<void>;
      act(() => {
        running = result.current.run();
      });
      act(() => {
        useAiSummaryStore
          .getState()
          .setStatus(
            change === 'reconfigure'
              ? { ...ready, baseUrl: 'http://127.0.0.1:5678', model: 'other' }
              : { ...ready, enabled: false },
          );
        useAiSummaryStore.getState().setStatus(ready);
      });
      await act(async () => {
        resolveHistory([{ at: 1, sender: 'Alice', body: 'Old engine request' }]);
        await running;
      });
      expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
      expect(result.current.pending).toBe(false);
      expect(useAiSummaryStore.getState().summaries).toEqual({});

      vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce([
        { at: 2, sender: 'Alice', body: 'Explicit new request' },
      ]);
      await act(async () => {
        await result.current.run();
      });
      expect(window.electronAPI.ai.summarize).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          messages: [{ at: 2, sender: 'Alice', body: 'Explicit new request' }],
        }),
      );
    },
  );
  it('does not restore an error from pending history after disable', async () => {
    let rejectHistory!: (error: Error) => void;
    vi.mocked(window.electronAPI.ai.getHistory).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectHistory = reject;
      }),
    );
    const { result } = renderHook(() => useConversationSummary(input));
    let running!: Promise<void>;
    act(() => {
      running = result.current.run();
    });
    act(() => {
      useAiSummaryStore.getState().setStatus({ ...ready, enabled: false });
    });
    await act(async () => {
      rejectHistory(new Error('History failed'));
      await running;
    });
    expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
    expect(useAiSummaryStore.getState().summaries).toEqual({});
    expect(result.current.pending).toBe(false);
  });
  it('invalidates pending history after unmount without blocking a remounted conversation', async () => {
    let resolveHistory!: (messages: AiSummaryMessage[]) => void;
    vi.mocked(window.electronAPI.ai.getHistory).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveHistory = resolve;
      }),
    );
    const original = renderHook(() => useConversationSummary(input));
    let running!: Promise<void>;
    act(() => {
      running = original.result.current.run();
    });
    original.unmount();
    const remounted = renderHook(() => useConversationSummary(input));
    await act(async () => {
      resolveHistory([{ at: 1, sender: 'Alice', body: 'Old unmounted request' }]);
      await running;
    });
    expect(window.electronAPI.ai.summarize).not.toHaveBeenCalled();
    expect(useAiSummaryStore.getState().summaries).toEqual({});
    vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce([
      { at: 2, sender: 'Alice', body: 'New mounted request' },
    ]);
    await act(async () => {
      await remounted.result.current.run();
    });
    expect(window.electronAPI.ai.summarize).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        messages: [{ at: 2, sender: 'Alice', body: 'New mounted request' }],
      }),
    );
  });
  it.each(['reconfigure', 'disable and re-enable'])(
    'releases a stalled history request immediately after %s and preserves a fresh request',
    async (change) => {
      let resolveHistory!: (messages: AiSummaryMessage[]) => void;
      vi.mocked(window.electronAPI.ai.getHistory).mockReturnValueOnce(
        new Promise((resolve) => {
          resolveHistory = resolve;
        }),
      );
      const { result } = renderHook(() => useConversationSummary(input));
      let stale!: Promise<void>;
      act(() => {
        stale = result.current.run();
      });
      expect(result.current.pending).toBe(true);
      act(() => {
        useAiSummaryStore
          .getState()
          .setStatus(
            change === 'reconfigure'
              ? { ...ready, model: 'new-model' }
              : { ...ready, enabled: false },
          );
        if (change !== 'reconfigure') useAiSummaryStore.getState().setStatus(ready);
      });
      expect(result.current.pending).toBe(false);
      vi.mocked(window.electronAPI.ai.getHistory).mockResolvedValueOnce([
        { at: 2, sender: 'Alice', body: 'New configured request' },
      ]);
      vi.mocked(window.electronAPI.ai.summarize).mockResolvedValueOnce({ ok: true });
      let fresh!: Promise<void>;
      await act(async () => {
        fresh = result.current.run();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(result.current.pending).toBe(true);
      await act(async () => {
        resolveHistory([{ at: 1, sender: 'Alice', body: 'Old configuration request' }]);
        await stale;
      });
      expect(window.electronAPI.ai.summarize).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          messages: [{ at: 2, sender: 'Alice', body: 'New configured request' }],
        }),
      );
      expect(result.current.pending).toBe(true);
      expect(result.current.state?.error).toBeUndefined();
      await act(async () => {
        result.current.cancel();
        await fresh;
      });
    },
  );
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
      const summarize = vi.mocked(window.electronAPI.ai.summarize).getMockImplementation()!;
      vi.mocked(window.electronAPI.ai.summarize).mockImplementationOnce(async (request) => ({
        ...(await summarize(request)),
        summaryInput: { messageCount: 41, truncated: true },
      }));
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

it.each(['linux', 'darwin', 'win32'] as const)(
  'retains protocol and conversation ranges across switches and remounts on %s',
  async (platform) => {
    vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
    for (const protocol of ['meshtastic', 'meshcore', 'reticulum'] as const) {
      const first = {
        ...input,
        protocol,
        history: null,
        messages: [{ at: Date.now(), sender: 'A', body: 'Status' }],
      };
      const { result, rerender, unmount } = renderHook(
        ({ key }) => useConversationSummary({ ...first, key }),
        { initialProps: { key: 'one' } },
      );
      act(() => {
        result.current.setScope({ kind: 'hours', hours: 12 });
      });
      rerender({ key: 'two' });
      expect(result.current.scope).toEqual({ kind: 'unread' });
      act(() => {
        result.current.setScope({ kind: 'loaded' });
      });
      rerender({ key: 'one' });
      expect(result.current.scope).toEqual({ kind: 'hours', hours: 12 });
      unmount();
      const remounted = renderHook(() => useConversationSummary(first));
      expect(remounted.result.current.scope).toEqual({ kind: 'hours', hours: 12 });
      await act(async () => {
        await remounted.result.current.run();
      });
      expect(window.electronAPI.ai.summarize).toHaveBeenLastCalledWith(
        expect.objectContaining({ protocol, scope: { kind: 'hours', hours: 12 } }),
      );
      remounted.unmount();
      disposeAiSummaries();
      useAiSummaryStore.getState().setStatus(ready);
    }
  },
);
