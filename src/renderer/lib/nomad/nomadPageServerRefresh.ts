/** Pure helpers for Nomad My Pages refresh (keeps panel cognitive complexity down). */

export interface NomadServingListResult {
  ok: boolean;
  pages?: unknown[];
  files?: unknown[];
  error?: string;
}

export interface NomadServingStatusResult {
  ok: boolean;
  error?: string;
  serving?: {
    display_name?: string | null;
    last_error?: string | null;
  } | null;
}

export type ServingStatusApply =
  | { kind: 'sidecar_down' }
  | {
      kind: 'status';
      serving: NonNullable<NomadServingStatusResult['serving']>;
      displayName?: string;
      clearHostingErrorLog: boolean;
      statusError?: string;
    }
  | { kind: 'status_error'; error: string | undefined }
  | { kind: 'noop' };

export function planServingStatusApply(
  statusRes: NomadServingStatusResult,
  displayNameDirty: boolean,
): ServingStatusApply {
  if (statusRes.error === 'sidecar_not_running') {
    return { kind: 'sidecar_down' };
  }
  if (statusRes.ok && statusRes.serving) {
    const serving = statusRes.serving;
    return {
      kind: 'status',
      serving,
      displayName: displayNameDirty ? undefined : (serving.display_name ?? ''),
      clearHostingErrorLog: !serving.last_error,
      statusError: serving.last_error?.trim() || undefined,
    };
  }
  if (!statusRes.ok) {
    return { kind: 'status_error', error: statusRes.error };
  }
  return { kind: 'noop' };
}

export interface ServingListsApply {
  pages?: unknown[];
  files?: unknown[];
  clearError?: boolean;
  pagesError?: string;
  filesError?: string;
}

export function planServingListsApply(
  statusRes: NomadServingStatusResult,
  pagesRes: NomadServingListResult,
  filesRes: NomadServingListResult,
): ServingListsApply {
  const out: ServingListsApply = {};
  if (pagesRes.ok && pagesRes.pages) {
    out.pages = pagesRes.pages;
    if (statusRes.ok && !statusRes.serving?.last_error) {
      out.clearError = true;
    }
  } else if (!pagesRes.ok) {
    out.pagesError = pagesRes.error;
  }
  if (filesRes.ok && filesRes.files) {
    out.files = filesRes.files;
  } else if (!filesRes.ok) {
    out.filesError = filesRes.error;
  }
  return out;
}
