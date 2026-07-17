/** Sidecar proxy helpers for Nomad Network static page hosting. */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadServingPageEntry, NomadServingStatus } from '@/shared/nomad-types';

export interface NomadServingOkResponse {
  ok: true;
  serving?: NomadServingStatus;
  pages?: NomadServingPageEntry[];
  content?: string;
  error?: undefined;
}

export interface NomadServingErrResponse {
  ok: false;
  error: string;
  serving?: NomadServingStatus;
  pages?: NomadServingPageEntry[];
  content?: string;
}

export type NomadServingApiResponse = NomadServingOkResponse | NomadServingErrResponse;

function asApiError(e: unknown): NomadServingErrResponse {
  return { ok: false, error: errLikeToLogString(e) };
}

export async function getServingStatus(): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/nomadnetwork/serving')) as {
      ok?: boolean;
      serving?: NomadServingStatus;
      error?: string;
    };
    if (body.serving) {
      return { ok: true, serving: body.serving };
    }
    return { ok: false, error: body.error ?? 'serving_status_unavailable' };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function setServing(opts: {
  enabled: boolean;
  displayName?: string;
}): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyPut('/api/v1/nomadnetwork/serving', {
      enabled: opts.enabled,
      display_name: opts.displayName?.trim() || undefined,
    })) as { ok?: boolean; serving?: NomadServingStatus; error?: string };
    if (body.ok === false) {
      return { ok: false, error: body.error ?? 'serving_update_failed', serving: body.serving };
    }
    return { ok: true, serving: body.serving };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function listServingPages(): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet(
      '/api/v1/nomadnetwork/serving/pages',
    )) as { ok?: boolean; pages?: NomadServingPageEntry[]; error?: string };
    if (body.ok === false || !body.pages) {
      return { ok: false, error: body.error ?? 'serving_pages_unavailable' };
    }
    return { ok: true, pages: body.pages };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function readServingPage(path: string): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const qs = new URLSearchParams({ path });
    const body = (await window.electronAPI.reticulum.proxyGet(
      `/api/v1/nomadnetwork/serving/page?${qs.toString()}`,
    )) as { ok?: boolean; content?: string; error?: string };
    if (!body.ok || body.content == null) {
      return { ok: false, error: body.error ?? 'serving_page_unavailable' };
    }
    return { ok: true, content: body.content };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function writeServingPage(
  path: string,
  content: string,
): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyPut(
      '/api/v1/nomadnetwork/serving/pages',
      { path, content },
    )) as { ok?: boolean; error?: string };
    if (body.ok === false) {
      return { ok: false, error: body.error ?? 'serving_page_write_failed' };
    }
    return { ok: true };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function deleteServingPage(path: string): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const qs = new URLSearchParams({ path });
    const body = (await window.electronAPI.reticulum.proxyDelete(
      `/api/v1/nomadnetwork/serving/pages?${qs.toString()}`,
    )) as { ok?: boolean; error?: string };
    if (body.ok === false) {
      return { ok: false, error: body.error ?? 'serving_page_delete_failed' };
    }
    return { ok: true };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}
