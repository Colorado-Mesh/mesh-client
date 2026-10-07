import { docsSitePageUrl } from '@/shared/docsSite';
import type { SystemReticulumInstance } from '@/shared/reticulum-types';

/** Docs section every "why mesh-client does not use system RNS" notice links to. */
export const RETICULUM_SYSTEM_RNS_DOCS_ANCHOR = 'using-mesh-client-with-other-reticulum-apps';
export const RETICULUM_SYSTEM_RNS_DOCS_URL = docsSitePageUrl(
  'reticulum',
  RETICULUM_SYSTEM_RNS_DOCS_ANCHOR,
);

export type ReticulumInstanceMode = 'shared' | 'standalone';

export interface ReticulumInstanceStatus {
  instanceMode: ReticulumInstanceMode | null;
  /** Shared endpoint owned by another Reticulum app (Share requested, not bound). */
  sharedInstanceConflict: string | null;
}

export const EMPTY_RETICULUM_INSTANCE_STATUS: ReticulumInstanceStatus = {
  instanceMode: null,
  sharedInstanceConflict: null,
};

/** Parse `GET /api/v1/status` instance fields (sidecar never reports client mode). */
export function parseReticulumInstanceStatus(raw: unknown): ReticulumInstanceStatus {
  if (raw == null || typeof raw !== 'object') return EMPTY_RETICULUM_INSTANCE_STATUS;
  const o = raw as Record<string, unknown>;
  const mode = o.instance_mode;
  const conflict = o.shared_instance_conflict;
  return {
    instanceMode: mode === 'shared' || mode === 'standalone' ? mode : null,
    sharedInstanceConflict: typeof conflict === 'string' && conflict.trim() ? conflict : null,
  };
}

/** A probe hit is foreign unless it is mesh-client's own TCP shared listener. */
export function isForeignSystemReticulum(
  probe: SystemReticulumInstance | null,
  selfHostsSharedInstance: boolean,
): boolean {
  if (!probe?.running) return false;
  return !(selfHostsSharedInstance && probe.sharedInstanceType === 'tcp');
}

export async function fetchReticulumInstanceStatus(): Promise<ReticulumInstanceStatus> {
  return parseReticulumInstanceStatus(
    await window.electronAPI.reticulum.proxyGet('/api/v1/status'),
  );
}

export interface ReticulumSharedInstanceClientSettings {
  hosting: boolean;
  sharedInstanceType: 'tcp' | 'unix';
  sharedInstancePort: number;
  instanceControlPort: number;
  instanceName: string;
  rpcKey: string | null;
}

export function parseReticulumSharedInstanceClientSettings(
  raw: unknown,
): ReticulumSharedInstanceClientSettings | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.shared_instance_port !== 'number' || typeof o.instance_control_port !== 'number') {
    return null;
  }
  return {
    hosting: o.hosting === true,
    sharedInstanceType: o.shared_instance_type === 'unix' ? 'unix' : 'tcp',
    sharedInstancePort: o.shared_instance_port,
    instanceControlPort: o.instance_control_port,
    instanceName: typeof o.instance_name === 'string' ? o.instance_name : 'default',
    rpcKey: typeof o.rpc_key === 'string' && o.rpc_key ? o.rpc_key : null,
  };
}

/** `[reticulum]` lines another app needs to attach to mesh-client's shared instance. */
export function buildReticulumSharedInstanceClientSnippet(
  settings: ReticulumSharedInstanceClientSettings,
): string {
  const lines = ['[reticulum]', 'share_instance = Yes'];
  if (settings.sharedInstanceType === 'unix') {
    lines.push('shared_instance_type = unix', `instance_name = ${settings.instanceName}`);
  } else {
    lines.push(
      'shared_instance_type = tcp',
      `shared_instance_port = ${settings.sharedInstancePort}`,
      `instance_control_port = ${settings.instanceControlPort}`,
    );
  }
  if (settings.rpcKey) lines.push(`rpc_key = ${settings.rpcKey}`);
  return lines.join('\n');
}
