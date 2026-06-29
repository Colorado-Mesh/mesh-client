/** Reticulum sidecar IPC types (MIT — wire DTOs only). */

export interface ReticulumSidecarStatus {
  running: boolean;
  port: number;
  pid: number | null;
  lastError?: string;
}

export interface ReticulumSidecarStartOptions {
  /** When true, reuse existing process if healthy. */
  reuseIfRunning?: boolean;
}

export interface ReticulumStatusResponse {
  status: string;
  version: string;
  rns_ready: boolean;
  lxmf_ready: boolean;
}

export interface ReticulumSidecarEvent {
  type: string;
  payload: unknown;
}
