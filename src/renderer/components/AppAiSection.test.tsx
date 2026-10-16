import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import i18n from '@/renderer/lib/i18n';
import { disposeAiSummaries, useAiSummaryStore } from '@/renderer/stores/aiSummaryStore';
import type { AiProviderStatus } from '@/shared/ai-types';

import { AppAiSection } from './AppAiSection';

afterEach(() => {
  cleanup();
  disposeAiSummaries();
  useAiSummaryStore.setState({ status: null });
  vi.restoreAllMocks();
});

it('explains offline processing time in the downloaded-model settings', async () => {
  await i18n.changeLanguage('en');
  const status: AiProviderStatus = {
    enabled: true,
    engine: 'bundled',
    wireFormat: 'openai',
    baseUrl: '',
    model: '',
    hasApiKey: false,
    allowRemote: false,
    isRemote: false,
    localEngine: { ready: false, modelId: null, downloading: false },
    osAi: { available: false, platform: null },
  };
  const unsubscribe = () => () => {};
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      ai: {
        getStatus: vi.fn().mockResolvedValue(status),
        listLocalModels: vi.fn().mockResolvedValue([]),
        probeOsAi: vi.fn().mockResolvedValue(status.osAi),
        onSummaryChunk: unsubscribe,
        onSummaryDone: unsubscribe,
        onSummaryError: unsubscribe,
        onStatusChanged: unsubscribe,
        onModelProgress: unsubscribe,
      },
    },
  });
  useAiSummaryStore.setState({ status });
  const { container } = render(<AppAiSection />);
  const details = container.querySelector('details')!;
  await act(async () => {
    const toggled = new Promise<void>((resolve) => {
      details.addEventListener(
        'toggle',
        () => {
          resolve();
        },
        { once: true },
      );
    });
    details.open = true;
    await toggled;
  });
  expect(
    await screen.findByText(/Large conversations can take a few minutes with downloaded models/),
  ).toBeVisible();
});
