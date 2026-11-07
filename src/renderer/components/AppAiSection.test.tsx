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
    mlxHelperAvailable: false,
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
    mlxHelperAvailable: false,
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
            name: 'Llama 3.2 3B',
            paramsLabel: '3B',
            downloadBytes: 2019377696,
            diskBytes: 2019377696,
            license: 'Llama 3.2 Community License',
            installed: false,
            runtime: 'wllama',
            recommendation: 'quality',
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
    expect(await screen.findByText('Llama 3.2 3B')).toBeVisible();
    expect(screen.getByText('Recommended for quality')).toBeVisible();
    expect(screen.getByText(/CPU \(portable\)/)).toBeVisible();
    expect(screen.queryByText(/Faster for slower machines/)).toBeNull();
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

it.each(['linux', 'darwin', 'win32'])(
  'shows Apple Silicon MLX recommendations ahead of portable GGUF cards on %s',
  async () => {
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
      mlxHelperAvailable: true,
      osAi: { available: false, platform: null },
    };
    const unsubscribe = () => () => {};
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        ai: {
          getStatus: vi.fn().mockResolvedValue(status),
          setConfig: vi.fn(),
          listLocalModels: vi.fn().mockResolvedValue([
            {
              id: 'llama3.2-3b-instruct-mlx-4bit',
              name: 'Llama 3.2 3B Instruct MLX 4-bit',
              paramsLabel: '3B',
              downloadBytes: 1_800_000_000,
              diskBytes: 1_800_000_000,
              license: 'Llama 3.2 Community License',
              installed: false,
              runtime: 'mlx',
              recommendation: 'quality',
            },
            {
              id: 'qwen2.5-1.5b-instruct-mlx-4bit',
              name: 'Qwen2.5 1.5B Instruct MLX 4-bit',
              paramsLabel: '1.5B',
              downloadBytes: 900_000_000,
              diskBytes: 900_000_000,
              license: 'Apache-2.0',
              installed: false,
              runtime: 'mlx',
              recommendation: 'fasterMachines',
            },
            {
              id: 'llama3.2-3b-instruct-q4',
              name: 'Llama 3.2 3B Instruct Q4_K_M',
              paramsLabel: '3B',
              downloadBytes: 2_019_377_696,
              diskBytes: 2_019_377_696,
              license: 'Llama 3.2 Community License',
              installed: false,
              runtime: 'wllama',
            },
            {
              id: 'qwen2.5-1.5b-instruct-q4',
              name: 'Qwen2.5 1.5B Instruct Q4_K_M',
              paramsLabel: '1.5B',
              downloadBytes: 1_117_320_736,
              diskBytes: 1_117_320_736,
              license: 'Apache-2.0',
              installed: false,
              runtime: 'wllama',
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
    expect(await screen.findByText('Llama 3.2 3B Instruct MLX 4-bit')).toBeVisible();
    expect(
      screen.getByText('On this Mac, Apple Silicon (MLX) models are recommended for Catch up.'),
    ).toBeVisible();
    expect(screen.getByText('Recommended for quality')).toBeVisible();
    expect(screen.getByText('Faster for slower machines')).toBeVisible();
    expect(screen.getAllByText(/Recommended on macOS/)).toHaveLength(2);
    expect(screen.getAllByText(/CPU \(portable\)/)).toHaveLength(2);
    const names = Array.from(container.querySelectorAll('.border-ink-700 > p:first-child')).map(
      (node) => node.textContent,
    );
    expect(names.slice(0, 4)).toEqual([
      'Llama 3.2 3B Instruct MLX 4-bit',
      'Qwen2.5 1.5B Instruct MLX 4-bit',
      'Llama 3.2 3B Instruct Q4_K_M',
      'Qwen2.5 1.5B Instruct Q4_K_M',
    ]);
  },
);

it('lists retired on-disk models so they can be removed', async () => {
  const removeLocalModel = vi.fn().mockResolvedValue([]);
  const status: AiProviderStatus = {
    enabled: true,
    engine: 'os',
    wireFormat: null,
    baseUrl: '',
    model: '',
    hasApiKey: false,
    timeoutSeconds: 300,
    maxCollectedMessages: 2000,
    allowRemote: false,
    isRemote: false,
    localEngine: { ready: false, modelId: null, downloading: false },
    mlxHelperAvailable: false,
    osAi: {
      available: true,
      platform: 'apple-foundation-models',
      modelLabel: 'Apple Intelligence',
    },
  };
  const unsubscribe = () => () => {};
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      ai: {
        getStatus: vi.fn().mockResolvedValue(status),
        setConfig: vi.fn(),
        listLocalModels: vi.fn().mockResolvedValue([
          {
            id: 'llama3.2-1b-instruct-q4',
            name: 'llama3.2-1b-instruct-q4',
            paramsLabel: '—',
            downloadBytes: 807694464,
            diskBytes: 807694464,
            license: '—',
            installed: true,
            orphan: true,
          },
        ]),
        removeLocalModel,
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
  expect(await screen.findByText('Unused downloads')).toBeVisible();
  expect(screen.getByText('llama3.2-1b-instruct-q4')).toBeVisible();
  expect(screen.getByText(/No longer in catalog/)).toBeVisible();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /Remove llama3.2-1b-instruct-q4/ }));
    await Promise.resolve();
  });
  expect(removeLocalModel).toHaveBeenCalledWith('llama3.2-1b-instruct-q4');
});
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
