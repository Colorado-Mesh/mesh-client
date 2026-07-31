// @vitest-environment jsdom
import type { TFunction } from 'i18next';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  acceptRncpOffer,
  rejectRncpOffer,
  toastRncpRequestEnableResult,
} from './rncpTransferUiHelpers';

const t = ((key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts === 'object') {
    const parts = Object.entries(opts)
      .filter(([k]) => k !== 'defaultValue')
      .map(([k, v]) => `${k}=${String(v)}`);
    return parts.length > 0 ? `${key}|${parts.join(',')}` : key;
  }
  return key;
}) as TFunction;

describe('toastRncpRequestEnableResult', () => {
  it('toasts success', () => {
    const addToast = vi.fn();
    toastRncpRequestEnableResult({ ok: true }, addToast, t);
    expect(addToast).toHaveBeenCalledWith('reticulumRemote.transfer.requestEnableSent', 'success');
  });

  it('toasts rate_limited as info', () => {
    const addToast = vi.fn();
    toastRncpRequestEnableResult({ ok: false, error: 'rate_limited' }, addToast, t);
    expect(addToast).toHaveBeenCalledWith(
      'reticulumRemote.transfer.requestEnableRateLimited',
      'info',
    );
  });

  it('toasts other failures with detail', () => {
    const addToast = vi.fn();
    toastRncpRequestEnableResult({ ok: false, error: 'send_failed', detail: 'boom' }, addToast, t);
    expect(addToast).toHaveBeenCalledWith(
      'reticulumRemote.transfer.requestEnableFailed|error=boom',
      'error',
    );
  });

  it('falls back to common.error when detail is missing', () => {
    const addToast = vi.fn();
    toastRncpRequestEnableResult({ ok: false, error: 'invalid_peer' }, addToast, t);
    expect(addToast).toHaveBeenCalledWith(
      'reticulumRemote.transfer.requestEnableFailed|error=common.error',
      'error',
    );
  });
});

describe('acceptRncpOffer', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockResolvedValue({ ok: true });
  });

  it('accepts via IPC and removes the offer', async () => {
    const removeOffer = vi.fn();
    const addToast = vi.fn();
    await acceptRncpOffer('t1', {
      removeOffer,
      addToast,
      t,
      logTag: 'test',
    });
    expect(window.electronAPI.reticulum.rncp.accept).toHaveBeenCalledWith({ transfer_id: 't1' });
    expect(removeOffer).toHaveBeenCalledWith('t1');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('toasts on accept failure and keeps the offer', async () => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.mocked(window.electronAPI.reticulum.rncp.accept).mockRejectedValue(new Error('nope'));
    const removeOffer = vi.fn();
    const addToast = vi.fn();
    await acceptRncpOffer('t2', {
      removeOffer,
      addToast,
      t,
      logTag: 'test',
    });
    expect(removeOffer).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith(
      expect.stringContaining('reticulumRemote.transfer.acceptFailed'),
      'error',
    );
  });
});

describe('rejectRncpOffer', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockReset();
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockResolvedValue({ ok: true });
  });

  it('rejects via IPC and always removes the offer', async () => {
    const removeOffer = vi.fn();
    await rejectRncpOffer('t3', { removeOffer, logTag: 'test' });
    expect(window.electronAPI.reticulum.rncp.reject).toHaveBeenCalledWith({ transfer_id: 't3' });
    expect(removeOffer).toHaveBeenCalledWith('t3');
  });

  it('still removes the offer when reject IPC fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(window.electronAPI.reticulum.rncp.reject).mockRejectedValue(new Error('down'));
    const removeOffer = vi.fn();
    await rejectRncpOffer('t4', { removeOffer, logTag: 'test' });
    expect(removeOffer).toHaveBeenCalledWith('t4');
  });
});
