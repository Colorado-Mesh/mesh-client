/** Sidecar proxy helpers for Nomad Network static page hosting. */

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';
import type { NomadServingPageEntry, NomadServingStatus } from '@/shared/nomad-types';

/**
 * Max raw upload size for My Pages file PUT.
 * Base64 + JSON must fit the sidecar Axum 4 MiB body limit; leave headroom.
 */
export const NOMAD_SERVING_FILE_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;

export interface NomadServingOkResponse {
  ok: true;
  serving?: NomadServingStatus;
  pages?: NomadServingPageEntry[];
  files?: NomadServingPageEntry[];
  content?: string;
  error?: undefined;
}

export interface NomadServingErrResponse {
  ok: false;
  error: string;
  serving?: NomadServingStatus;
  pages?: NomadServingPageEntry[];
  files?: NomadServingPageEntry[];
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

export async function writeServingFile(
  path: string,
  contentBase64: string,
): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyPut(
      '/api/v1/nomadnetwork/serving/files',
      { path, content_base64: contentBase64 },
    )) as { ok?: boolean; error?: string };
    if (body.ok === false) {
      return { ok: false, error: body.error ?? 'serving_file_write_failed' };
    }
    return { ok: true };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function deleteServingFile(path: string): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const qs = new URLSearchParams({ path });
    const body = (await window.electronAPI.reticulum.proxyDelete(
      `/api/v1/nomadnetwork/serving/files?${qs.toString()}`,
    )) as { ok?: boolean; error?: string };
    if (body.ok === false) {
      return { ok: false, error: body.error ?? 'serving_file_delete_failed' };
    }
    return { ok: true };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return asApiError(e);
  }
}

export async function setServingContentSource(
  path: string | null,
): Promise<NomadServingApiResponse> {
  if (!(await isReticulumSidecarRunning())) {
    return { ok: false, error: 'sidecar_not_running' };
  }
  try {
    const body = (await window.electronAPI.reticulum.proxyPut(
      '/api/v1/nomadnetwork/serving/content-source',
      { path },
    )) as { ok?: boolean; serving?: NomadServingStatus; error?: string };
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

/** Encode a File for serving upload; rejects oversize before base64 work. */
export async function encodeServingFileUpload(
  file: File,
  maxBytes: number = NOMAD_SERVING_FILE_UPLOAD_MAX_BYTES,
): Promise<{ ok: true; path: string; contentBase64: string } | { ok: false; error: string }> {
  const path = file.name.trim().replace(/^\/+/, '');
  if (!path || path.includes('/') || path.includes('\\') || path.includes('..')) {
    return { ok: false, error: 'invalid_file_path' };
  }
  if (file.size > maxBytes) {
    return { ok: false, error: 'file_too_large' };
  }
  try {
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return { ok: false, error: 'file_too_large' };
    }
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return { ok: true, path, contentBase64: btoa(binary) };
  } catch (e) {
    // catch-no-log-ok returned to caller for panel UI
    return { ok: false, error: errLikeToLogString(e) };
  }
}
