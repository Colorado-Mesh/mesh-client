import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { disposeAiSummaries, useAiSummaryStore } from '@/renderer/stores/aiSummaryStore';
import type { AiProviderStatus, AiSummaryMessage } from '@/shared/ai-types';

import { useConversationSummary } from './useConversationSummary';

const ready: AiProviderStatus = {
  enabled: true,
  engine: 'local',
  wireFormat: 'openai',
  baseUrl: 'http://127.0.0.1:1234',
  model: 'test',
  hasApiKey: false,
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
  disposeAiSummaries();
  useAiSummaryStore.getState().setStatus(ready);
  vi.mocked(window.electronAPI.ai.summarize).mockResolvedValue({ ok: true });
});
describe('conversation summary async boundaries', () => {
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
