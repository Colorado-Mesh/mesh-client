import type { TFunction } from 'i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';

export interface ReticulumIdentityStatus {
  configured: boolean;
  lxmfHash: string | null;
}

export interface ReticulumPeerPathResult {
  ok: boolean;
  error?: string;
}

export interface ReticulumPeerProbeResult {
  ok: boolean;
  hops?: number;
  mode?: string;
  error?: string;
}

/** True when the Reticulum sidecar process is listening. */
export async function isReticulumSidecarRunning(): Promise<boolean> {
  try {
    const status = await window.electronAPI.reticulum.getStatus();
    return status.running && status.port > 0;
  } catch {
    // catch-no-log-ok getStatus unavailable — treat as not running
    return false;
  }
}

export function isReticulumSidecarNotRunningError(err: unknown): boolean {
  return errLikeToLogString(err).toLowerCase().includes('not running');
}

export function isReticulumSidecar404Error(err: unknown): boolean {
  return errLikeToLogString(err).includes('404');
}

export function isReticulumSidecarExpectedProxyError(err: unknown): boolean {
  const msg = errLikeToLogString(err).toLowerCase();
  return (
    isReticulumSidecarNotRunningError(err) ||
    isReticulumSidecar404Error(err) ||
    msg.includes('fetch failed') ||
    msg.includes('aborted')
  );
}

export interface ReticulumSidecarInterfaceRow {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  status: string;
}

/** Fetch configured sidecar interfaces (shared by runtime and radio panel). */
export async function fetchReticulumInterfaces(): Promise<ReticulumSidecarInterfaceRow[]> {
  if (!(await isReticulumSidecarRunning())) {
    return [];
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/interfaces')) as {
      interfaces?: ReticulumSidecarInterfaceRow[];
    };
    return body.interfaces ?? [];
  } catch (e) {
    if (!isReticulumSidecarExpectedProxyError(e)) {
      console.debug('[reticulumSidecarReads] interfaces ' + errLikeToLogString(e));
    }
    return [];
  }
}

/** Fetch sidecar identity status (shared by runtime and connection/radio panels). */
export async function fetchReticulumIdentityStatus(): Promise<ReticulumIdentityStatus> {
  if (!(await isReticulumSidecarRunning())) {
    return { configured: false, lxmfHash: null };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/identity/status')) as {
      configured?: boolean;
      lxmf_hash?: string;
    };
    const lxmfHash = body.configured && body.lxmf_hash ? body.lxmf_hash : null;
    if (lxmfHash) {
      registerReticulumDestinationHash(reticulumHashToNodeId(lxmfHash), lxmfHash);
    }
    return { configured: Boolean(body.configured), lxmfHash };
  } catch (e) {
    if (!isReticulumSidecarExpectedProxyError(e)) {
      console.debug('[reticulumSidecarReads] identity status ' + errLikeToLogString(e));
    }
    return { configured: false, lxmfHash: null };
  }
}

export async function requestReticulumPeerPath(hash: string): Promise<ReticulumPeerPathResult> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const res = (await window.electronAPI.reticulum.proxyPost(
      `/api/v1/peers/${hash}/path`,
      {},
    )) as { ok?: boolean; error?: string };
    return { ok: Boolean(res.ok), error: res.error };
  } catch (e) {
    // catch-no-log-ok error returned to caller for toast/UI
    return { ok: false, error: errLikeToLogString(e) };
  }
}

export async function probeReticulumPeer(hash: string): Promise<ReticulumPeerProbeResult> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const res = (await window.electronAPI.reticulum.proxyPost(
      `/api/v1/peers/${hash}/probe`,
      {},
    )) as { ok?: boolean; hops?: number; mode?: string; error?: string };
    return {
      ok: Boolean(res.ok),
      hops: res.hops,
      mode: res.mode,
      error: res.error,
    };
  } catch (e) {
    // catch-no-log-ok error returned to caller for toast/UI
    return { ok: false, error: errLikeToLogString(e) };
  }
}

export function formatReticulumPeerPathToast(
  t: TFunction,
  result: ReticulumPeerPathResult,
): { message: string; variant: 'success' | 'error' } {
  if (result.ok) {
    return { message: t('peerDetailModal.pathOk'), variant: 'success' };
  }
  return {
    message: t('peerDetailModal.pathFailed', { error: result.error ?? t('common.error') }),
    variant: 'error',
  };
}

export function formatReticulumPeerProbeToast(
  t: TFunction,
  result: ReticulumPeerProbeResult,
): { message: string; variant: 'success' | 'error' } {
  if (result.ok && result.hops != null) {
    return {
      message: t('peerDetailModal.probeHops', { hops: result.hops }),
      variant: 'success',
    };
  }
  if (result.ok && result.mode) {
    return {
      message: t('peerDetailModal.probeLocal', { mode: result.mode }),
      variant: 'success',
    };
  }
  if (result.ok) {
    return { message: t('peerDetailModal.probeOk'), variant: 'success' };
  }
  return {
    message: t('peerDetailModal.probeFailed', { error: result.error ?? t('common.error') }),
    variant: 'error',
  };
}
