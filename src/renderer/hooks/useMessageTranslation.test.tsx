import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { subscribeOpenSettingRequests } from '@/renderer/lib/openSettingRequest';
import {
  resetTranslation,
  translationStatus,
} from '@/renderer/lib/translation/translationTestFixtures';

import { useMessageTranslation } from './useMessageTranslation';

describe('manual message translation', () => {
  beforeEach(() => {
    resetTranslation();
  });
  it('opens opt-in settings while disabled without sending text', async () => {
    const api = resetTranslation({ ...translationStatus(false), enabled: false });
    const requests: unknown[] = [];
    const unsubscribe = subscribeOpenSettingRequests((request) => requests.push(request));
    const { result } = renderHook(() => useMessageTranslation('disabled', 'Bonjour à tous'));
    await act(async () => {
      await result.current.translate();
    });
    expect(requests).toEqual([{ slot: 'App', id: 'app.translation' }]);
    expect(api.translate).not.toHaveBeenCalled();
    unsubscribe();
  });
  it('shows pending, success and toggle states, then reuses cached text', async () => {
    const api = resetTranslation();
    let finish!: (value: Awaited<ReturnType<typeof api.translate>>) => void;
    api.translate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      ({ id }) => useMessageTranslation(id, 'Bonjour à tous'),
      { initialProps: { id: 'one' } },
    );
    expect(result.current.state.loading).toBe(false);
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.translate();
    });
    await waitFor(() => {
      expect(result.current.state.loading).toBe(true);
    });
    await waitFor(() => {
      expect(api.translate).toHaveBeenCalled();
    });
    await act(async () => {
      finish({ ok: true, text: 'Hello everyone', detectedLang: 'fr', provider: 'offline' });
      await pending;
    });
    expect(result.current.state.result).toMatchObject({ ok: true });
    act(() => {
      result.current.toggle();
    });
    expect(result.current.state.showTranslation).toBe(false);
    rerender({ id: 'two' });
    await act(async () => {
      await result.current.translate();
    });
    expect(api.translate).toHaveBeenCalledTimes(1);
  });
  it.each(['missingPack', 'error'] as const)(
    'preserves the %s result and offers online only after opt-in',
    async (reason) => {
      const api = resetTranslation();
      api.translate.mockResolvedValue({ ok: false, reason });
      const { result } = renderHook(() => useMessageTranslation(reason, 'Bonjour à tous'));
      await act(async () => {
        await result.current.translate();
      });
      expect(result.current.state.result).toEqual({ ok: false, reason });
      expect(result.current.libreEnabled).toBe(false);
    },
  );
});
