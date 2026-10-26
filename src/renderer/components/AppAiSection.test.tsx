import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import * as aiWorkerHost from '@/renderer/lib/aiWorkerHost';
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
    timeoutSeconds: 60,
    maxCollectedMessages: 2000,
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

it('warns when the bundled WASM thread budget is below six', async () => {
  vi.spyOn(aiWorkerHost, 'isBundledWllamaThreadBudgetLow').mockReturnValue(true);
  vi.spyOn(aiWorkerHost, 'bundledWllamaThreadCount').mockReturnValue(2);
  await openSettings({ engine: 'bundled' });
  expect(screen.getByRole('alert')).toHaveTextContent(
    /only 2 Catch up WASM thread\(s\).*about 6 or more/i,
  );
});

it('hides the thread-budget warning when the bundled budget is sufficient', async () => {
  vi.spyOn(aiWorkerHost, 'isBundledWllamaThreadBudgetLow').mockReturnValue(false);
  vi.spyOn(aiWorkerHost, 'bundledWllamaThreadCount').mockReturnValue(6);
  await openSettings({ engine: 'bundled' });
  expect(screen.queryByRole('alert')).toBeNull();
});

it('hides the thread-budget warning for non-bundled engines even when the budget is low', async () => {
  vi.spyOn(aiWorkerHost, 'isBundledWllamaThreadBudgetLow').mockReturnValue(true);
  vi.spyOn(aiWorkerHost, 'bundledWllamaThreadCount').mockReturnValue(1);
  await openSettings({
    engine: 'local',
    wireFormat: 'openai',
    baseUrl: 'http://127.0.0.1:11434',
  });
  expect(screen.queryByRole('alert')).toBeNull();
});

async function openSettings(patch: Partial<AiProviderStatus> = {}) {
  await i18n.changeLanguage('en');
  const status: AiProviderStatus = {
    enabled: true,
    engine: 'bundled',
    wireFormat: null,
    baseUrl: '',
    model: '',
    hasApiKey: false,
    timeoutSeconds: 300,
    maxCollectedMessages: 2000,
    allowRemote: false,
    isRemote: false,
    localEngine: { ready: false, modelId: null, downloading: false },
    osAi: { available: false, platform: null },
    ...patch,
  };
  const unsubscribe = () => () => {};
  const setConfig = vi
    .fn()
    .mockImplementation((input: { timeoutSeconds?: number; maxCollectedMessages?: number }) =>
      Promise.resolve({
        ...status,
        timeoutSeconds: input.timeoutSeconds ?? status.timeoutSeconds,
        maxCollectedMessages: input.maxCollectedMessages ?? status.maxCollectedMessages,
      }),
    );
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      ai: {
        getStatus: vi.fn().mockResolvedValue(status),
        setConfig,
        listLocalModels: vi.fn().mockResolvedValue([
          {
            id: 'llama',
            name: 'Llama 3.2 1B',
            paramsLabel: '1B',
            downloadBytes: 807694464,
            diskBytes: 807694464,
            license: 'Llama 3.2 Community License',
            installed: false,
          },
        ]),
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
  return { setConfig };
}
it.each(['linux', 'darwin', 'win32'])(
  'saves a validated timeout and shows factual model metadata on %s',
  async () => {
    const { setConfig } = await openSettings();
    expect(await screen.findByText('Llama 3.2 1B')).toBeVisible();
    expect(screen.queryByText(/Smaller download and memory/)).toBeNull();
    const input = screen.getByLabelText('Summary timeout (seconds)');
    fireEvent.change(input, { target: { value: '29' } });
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '900' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
      await Promise.resolve();
    });
    expect(setConfig).toHaveBeenCalledWith(expect.objectContaining({ timeoutSeconds: 900 }));
    expect(input).toHaveValue(900);
  },
);
it.each(['http://192.168.1.2:1234', 'http://ollama.local:1234', 'http://127.mesh.local:1234'])(
  'warns about saved and newly typed HTTP LAN credentials at %s',
  async (baseUrl) => {
    await openSettings({ engine: 'local', baseUrl, hasApiKey: true });
    expect(screen.getByRole('alert')).toHaveTextContent(/without transport encryption/);
    fireEvent.change(screen.getByLabelText('Server base URL'), {
      target: { value: baseUrl + '/' },
    });
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Clear saved key' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.change(screen.getByLabelText('API key (stored encrypted)'), {
      target: { value: 'typed-secret' },
    });
    expect(screen.getByRole('alert')).toBeVisible();
    fireEvent.change(screen.getByLabelText('Server base URL'), {
      target: { value: baseUrl.replace('http:', 'https:') },
    });
    expect(screen.queryByRole('alert')).toBeNull();
  },
);
it.each(['http://localhost:1234', 'http://127.0.0.1:1234', 'http://[::1]:1234'])(
  'keeps loopback key entry free of a LAN warning at %s',
  async (baseUrl) => {
    await openSettings({ engine: 'local', baseUrl, hasApiKey: true });
    expect(screen.queryByRole('alert')).toBeNull();
  },
);

it('requires saving endpoint and key edits before testing the connection', async () => {
  await openSettings({
    engine: 'local',
    wireFormat: 'openai',
    baseUrl: 'http://ollama.local:1234',
    model: 'test',
    hasApiKey: true,
  });
  const test = screen.getByRole('button', { name: 'Test connection' });
  expect(test).toBeEnabled();
  fireEvent.change(screen.getByLabelText('Server base URL'), {
    target: { value: 'https://ollama.local:1234' },
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(test).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Server base URL'), {
    target: { value: 'http://ollama.local:1234' },
  });
  expect(test).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Clear saved key' }));
  expect(test).toBeDisabled();
});

it('reenables connection testing after saving a canonicalized URL', async () => {
  await openSettings({
    engine: 'local',
    wireFormat: 'openai',
    baseUrl: 'http://ollama.local:1234',
    model: 'test',
    hasApiKey: true,
  });
  const test = screen.getByRole('button', { name: 'Test connection' });
  fireEvent.change(screen.getByLabelText('Server base URL'), {
    target: { value: 'http://ollama.local:1234/' },
  });
  expect(test).toBeDisabled();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
    await Promise.resolve();
  });
  expect(screen.getByLabelText('Server base URL')).toHaveValue('http://ollama.local:1234');
  expect(test).toBeEnabled();
});
it.each(['os', 'bundled'] as const)(
  'allows testing a saved %s configuration until its timeout changes',
  async (engine) => {
    await openSettings({
      engine,
      osAi: {
        available: engine === 'os',
        platform: engine === 'os' ? 'apple-foundation-models' : null,
      },
    });
    const test = screen.getByRole('button', { name: 'Test connection' });
    expect(test).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Summary timeout (seconds)'), {
      target: { value: '900' },
    });
    expect(test).toBeDisabled();
  },
);
