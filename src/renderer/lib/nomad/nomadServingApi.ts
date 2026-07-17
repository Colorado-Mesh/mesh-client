/** Sidecar proxy helpers for Nomad Network static page hosting. */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadServingPageEntry, NomadServingStatus } from '@/shared/nomad-types';

export interface NomadServingOkResponse {
  ok: true;
  serving?: NomadServingStatus;
  pages?: NomadServingPageEntry[];
  files?: NomadServingPageEntry[];
  error?: undefined;
}

export interface NomadServingErrResponse {
  ok: false;
  error: string;
  serving?: NomadServingStatus;
  pages?: NomadServingPageEntry[];
  files?: NomadServingPageEntry[];
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

export async function listServingFiles(): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyGet(
      '/api/v1/nomadnetwork/serving/files',
    )) as { ok?: boolean; files?: NomadServingPageEntry[]; error?: string };
    if (body.ok === false || !body.files) {
      return { ok: false, error: body.error ?? 'serving_files_unavailable' };
    }
    return { ok: true, files: body.files };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function setServingContentSource(path: string): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.setNomadContentSource(path)) as {
      ok?: boolean;
      serving?: NomadServingStatus;
      error?: string;
    };
    if (body.ok === false) {
      return {
        ok: false,
        error: body.error ?? 'content_source_update_failed',
        serving: body.serving,
      };
    }
    return { ok: true, serving: body.serving };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

/** Open a directory picker for the Nomad content source (main-process dialog). */
export async function pickServingContentSource(): Promise<
  { ok: true; path: string } | { ok: false; canceled: true } | { ok: false; error: string }
> {
  try {
    const result = await window.electronAPI.reticulum.showNomadContentSourceDialog();
    if (result.canceled || !result.path) {
      return { ok: false, canceled: true };
    }
    return { ok: true, path: result.path };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return { ok: false, error: errLikeToLogString(e) };
  }
}
