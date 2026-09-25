import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TAKRemoteStatus } from '@/shared/tak-types';

import { takIpcErrorMessage, useTakRemoteRelay, useTakRemoteStatus } from './useTakRemoteRelay';

const tak = () => window.electronAPI.tak;

describe('takIpcErrorMessage', () => {
  it('strips the Electron invoke prefix', () => {
    expect(
      takIpcErrorMessage(
        new Error("Error invoking remote method 'tak:remoteStart': Error: host must be set"),
      ),
    ).toBe('host must be set');
  });

  it('leaves other messages alone', () => {
    expect(takIpcErrorMessage(new Error('plain'))).toBe('plain');
    expect(takIpcErrorMessage('text')).toBe('text');
  });
});

describe('useTakRemoteStatus', () => {
  let push: ((s: TAKRemoteStatus) => void) | undefined;

  beforeEach(() => {
    push = undefined;
    vi.mocked(tak().onRemoteStatus).mockImplementation((cb) => {
      push = cb;
      return () => {};
    });
  });

  it('loads the current status and follows pushed updates', async () => {
    vi.mocked(tak().remoteGetStatus).mockResolvedValue({
      state: 'connected',
      host: 'tak.example.org',
      port: 8089,
    });
    const { result } = renderHook(() => useTakRemoteStatus());
    await act(async () => {});
    expect(result.current.state).toBe('connected');

    act(() => {
      push?.({ state: 'connecting', host: 'tak.example.org', port: 8089, error: 'reset' });
    });
    expect(result.current).toMatchObject({ state: 'connecting', error: 'reset' });
  });

  it('keeps a pushed status that arrives before the initial snapshot', async () => {
    let resolveSnapshot: ((s: TAKRemoteStatus) => void) | undefined;
    vi.mocked(tak().remoteGetStatus).mockReturnValue(
      new Promise((resolve) => {
        resolveSnapshot = resolve;
      }),
    );
    const { result } = renderHook(() => useTakRemoteStatus());
    act(() => {
      push?.({ state: 'connected', host: 'h', port: 1 });
    });
    resolveSnapshot?.({ state: 'disconnected', host: '', port: 8089 });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.state).toBe('connected');
  });
});

describe('useTakRemoteRelay', () => {
  beforeEach(() => {
    vi.mocked(tak().onRemoteStatus).mockReturnValue(() => {});
    vi.mocked(tak().remoteGetStatus).mockResolvedValue({
      state: 'disconnected',
      host: '',
      port: 8089,
    });
    vi.mocked(tak().remoteGetSettings).mockResolvedValue(null);
    vi.mocked(tak().remoteGetCredentials).mockResolvedValue({ caSubjects: [] });
    vi.mocked(tak().remoteImportCredentials).mockReset().mockResolvedValue(null);
  });

  it('reports saved settings as null (not undefined) once loaded', async () => {
    const { result } = renderHook(() => useTakRemoteRelay());
    expect(result.current.savedSettings).toBeUndefined();
    await act(async () => {});
    expect(result.current.savedSettings).toBeNull();
  });

  it('sends no password when the field is empty', async () => {
    const { result } = renderHook(() => useTakRemoteRelay());
    await act(async () => {
      await result.current.importCredentials('');
    });
    expect(tak().remoteImportCredentials).toHaveBeenCalledWith(undefined);
  });

  it('keeps the previous summary when the chooser is cancelled', async () => {
    vi.mocked(tak().remoteGetCredentials).mockResolvedValue({ caSubjects: ['CA'] });
    const { result } = renderHook(() => useTakRemoteRelay());
    await act(async () => {});
    await act(async () => {
      await result.current.importCredentials('pw');
    });
    expect(result.current.credentials).toEqual({ caSubjects: ['CA'] });
  });

  it('surfaces a failed connect as an error and clears busy', async () => {
    vi.mocked(tak().remoteStart).mockRejectedValueOnce(
      new Error("Error invoking remote method 'tak:remoteStart': Error: port must be an integer"),
    );
    const { result } = renderHook(() => useTakRemoteRelay());
    await act(async () => {
      await result.current.connect({
        host: 'tak.example.org',
        port: 8089,
        verifyServer: true,
        autoConnect: false,
      });
    });
    expect(result.current.error).toBe('port must be an integer');
    expect(result.current.isBusy).toBe(false);
  });
});
