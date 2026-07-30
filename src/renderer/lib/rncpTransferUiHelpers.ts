import type { TFunction } from 'i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { SendRncpRequestEnableResult } from '@/renderer/lib/sendRncpRequestEnable';

type ToastType = 'success' | 'error' | 'warning' | 'info';
type AddToast = (message: string, type?: ToastType, duration?: number) => void;

/** Shared toast outcomes for `sendRncpRequestEnable` (Chat DM + Remote Transfer). */
export function toastRncpRequestEnableResult(
  res: SendRncpRequestEnableResult,
  addToast: AddToast,
  t: TFunction,
): void {
  if (res.ok) {
    addToast(t('reticulumRemote.transfer.requestEnableSent'), 'success');
    return;
  }
  if (res.error === 'rate_limited') {
    addToast(t('reticulumRemote.transfer.requestEnableRateLimited'), 'info');
    return;
  }
  addToast(
    t('reticulumRemote.transfer.requestEnableFailed', {
      error: res.detail ?? t('common.error'),
    }),
    'error',
  );
}

export async function acceptRncpOffer(
  transferId: string,
  opts: {
    removeOffer: (transferId: string) => void;
    addToast: AddToast;
    t: TFunction;
    logTag: string;
  },
): Promise<void> {
  try {
    await window.electronAPI.reticulum.rncp.accept({ transfer_id: transferId });
    opts.removeOffer(transferId);
  } catch (e) {
    console.debug(`[${opts.logTag}] accept ` + errLikeToLogString(e));
    opts.addToast(
      opts.t('reticulumRemote.transfer.acceptFailed', { error: errLikeToLogString(e) }),
      'error',
    );
  }
}

export async function rejectRncpOffer(
  transferId: string,
  opts: {
    removeOffer: (transferId: string) => void;
    logTag: string;
  },
): Promise<void> {
  try {
    await window.electronAPI.reticulum.rncp.reject({ transfer_id: transferId });
  } catch (e) {
    console.warn(`[${opts.logTag}] reject ` + errLikeToLogString(e));
  } finally {
    opts.removeOffer(transferId);
  }
}
