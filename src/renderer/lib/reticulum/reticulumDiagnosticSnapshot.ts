import type { ReticulumSidecarStatus, ReticulumStatusResponse } from '@/shared/reticulum-types';

import { useDiagnosticsStore } from '../../stores/diagnosticsStore';
import { isReticulumDiagnosticRow } from '../diagnostics/ReticulumDiagnosticEngine';
import { errLikeToLogString } from '../errLikeToLogString';
import type { DiagnosticRow } from '../types';
import type { ReticulumConfigAuditIssue } from './reticulumConfigAudit';
import { getReticulumInboundLxmfDiagnostics } from './reticulumInboundLxmfDiagnostics';

const RETICULUM_PROXY_ROUTES = [
  '/api/v1/status',
  '/api/v1/app/info',
  '/api/v1/identity/status',
  '/api/v1/diagnostics',
  '/api/v1/config/audit',
  '/api/v1/stack/settings',
  '/api/v1/propagation',
] as const;

export type ReticulumDiagnosticProxyRoute = (typeof RETICULUM_PROXY_ROUTES)[number];

export type ReticulumDiagnosticFetchErrorKey = ReticulumDiagnosticProxyRoute | 'getStatus';

export interface ReticulumIdentityStatusWire {
  configured?: boolean;
  identity_hash?: string;
  lxmf_hash?: string;
  display_name?: string | null;
}

export interface ReticulumAppInfoWire {
  sidecar_version?: string;
  rns_version?: string;
  lxmf_version?: string;
}

export interface ReticulumStackDiagnosticPayload {
  status?: ReticulumStatusResponse;
  appInfo?: ReticulumAppInfoWire;
  identityStatus?: ReticulumIdentityStatusWire;
  diagnostics?: unknown;
  configAudit?: { issues?: ReticulumConfigAuditIssue[]; ok?: boolean; error?: string };
  stackSettings?: unknown;
  propagation?: unknown;
}

/** Sidecar + store diagnostic payload embedded in debug-snapshot.json. */
export interface ReticulumDiagnosticSidecarSnapshot {
  sidecar: ReticulumSidecarStatus;
  stack: ReticulumStackDiagnosticPayload | null;
  diagnosticRows: DiagnosticRow[];
  fetchErrors: Partial<Record<ReticulumDiagnosticFetchErrorKey, string>>;
  /** Inbound LXMF catch-up / WS lag counters (renderer process-local). */
  inboundLxmf?: {
    lastEventsLaggedAt: number | null;
    lastEventsLaggedSkipped: number | null;
    lastInboundCatchUpAt: number | null;
    lastInboundCatchUpCount: number | null;
    inboundCatchUpWatermarkTs: number | null;
    inboundCatchUpWatermarkSeq: number | null;
    lastInboundRingLen: number | null;
  };
}

function selectReticulumDiagnosticRows(): DiagnosticRow[] {
  return useDiagnosticsStore.getState().diagnosticRows.filter(isReticulumDiagnosticRow);
}

async function proxyGetSafe(path: ReticulumDiagnosticProxyRoute): Promise<{
  data?: unknown;
  error?: string;
}> {
  try {
    const data = await window.electronAPI.reticulum.proxyGet(path);
    return { data };
  } catch (e) {
    // catch-no-log-ok per-route proxy errors recorded in fetchErrors
    return { error: errLikeToLogString(e) };
  }
}

function assignStackPayload(
  stack: ReticulumStackDiagnosticPayload,
  path: ReticulumDiagnosticProxyRoute,
  data: unknown,
): void {
  switch (path) {
    case '/api/v1/status':
      stack.status = data as ReticulumStatusResponse;
      break;
    case '/api/v1/app/info':
      stack.appInfo = data as ReticulumAppInfoWire;
      break;
    case '/api/v1/identity/status':
      stack.identityStatus = data as ReticulumIdentityStatusWire;
      break;
    case '/api/v1/diagnostics':
      stack.diagnostics = data;
      break;
    case '/api/v1/config/audit':
      stack.configAudit = data as ReticulumStackDiagnosticPayload['configAudit'];
      break;
    case '/api/v1/stack/settings':
      stack.stackSettings = data;
      break;
    case '/api/v1/propagation':
      stack.propagation = data;
      break;
    default: {
      const _exhaustive: never = path;
      return _exhaustive;
    }
  }
}

/** Sync slice: sidecar status unavailable; diagnostic rows from store only. */
export function buildReticulumDiagnosticSnapshotSync(): ReticulumDiagnosticSidecarSnapshot {
  return {
    sidecar: { running: false, port: 0, pid: null },
    stack: null,
    diagnosticRows: selectReticulumDiagnosticRows(),
    fetchErrors: {},
    inboundLxmf: getReticulumInboundLxmfDiagnostics(),
  };
}

/** Fetch live sidecar APIs when the stack is running (GitHub-safe — no mnemonics or packet tap). */
export async function fetchReticulumDiagnosticSnapshot(): Promise<ReticulumDiagnosticSidecarSnapshot> {
  const fetchErrors: Partial<Record<ReticulumDiagnosticFetchErrorKey, string>> = {};
  let sidecar: ReticulumSidecarStatus;

  try {
    sidecar = await window.electronAPI.reticulum.getStatus();
  } catch (e) {
    // catch-no-log-ok getStatus failure surfaced in fetchErrors.getStatus
    fetchErrors.getStatus = errLikeToLogString(e);
    sidecar = { running: false, port: 0, pid: null };
  }

  const diagnosticRows = selectReticulumDiagnosticRows();
  const stack: ReticulumStackDiagnosticPayload = {};
  let anyStackData = false;

  if (sidecar.running && sidecar.port > 0) {
    const results = await Promise.all(
      RETICULUM_PROXY_ROUTES.map(async (path) => {
        const { data, error } = await proxyGetSafe(path);
        return { path, data, error };
      }),
    );

    for (const { path, data, error } of results) {
      if (error) fetchErrors[path] = error;
      if (data === undefined) continue;
      assignStackPayload(stack, path, data);
      anyStackData = true;
    }
  } else if (!sidecar.running) {
    fetchErrors['/api/v1/status'] = sidecar.lastError ?? 'sidecar not running';
  }

  return {
    sidecar,
    stack: anyStackData ? stack : null,
    diagnosticRows,
    fetchErrors,
    inboundLxmf: getReticulumInboundLxmfDiagnostics(),
  };
}
