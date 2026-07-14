/** Default stack-level identity re-announce interval (1 hour); mirrors sidecar `DEFAULT_ANNOUNCE_INTERVAL_SEC`. */
export const DEFAULT_ANNOUNCE_INTERVAL_SEC = 3600;

export interface ReticulumStackSettingsFields {
  enable_transport?: boolean;
  share_instance?: boolean;
  loglevel?: string | number;
  announce_interval_sec?: number;
}

export interface ReticulumStackSettingsPayload {
  enable_transport: boolean;
  share_instance: boolean;
  loglevel: number;
  announce_interval_sec: number;
}

/** Parse stack settings JSON from the sidecar config file. */
export function parseReticulumStackSettings(raw: unknown): ReticulumStackSettingsFields {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const obj = raw as Record<string, unknown>;
  const out: ReticulumStackSettingsFields = {};
  if (typeof obj.enable_transport === 'boolean') {
    out.enable_transport = obj.enable_transport;
  }
  if (typeof obj.share_instance === 'boolean') {
    out.share_instance = obj.share_instance;
  }
  if (typeof obj.loglevel === 'string' || typeof obj.loglevel === 'number') {
    out.loglevel = obj.loglevel;
  }
  if (typeof obj.announce_interval_sec === 'number' && Number.isFinite(obj.announce_interval_sec)) {
    out.announce_interval_sec = obj.announce_interval_sec;
  }
  return out;
}

/** Coerce announce interval from stack settings JSON; preserves explicit `0`. */
export function coerceAnnounceIntervalSec(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw;
  }
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : DEFAULT_ANNOUNCE_INTERVAL_SEC;
}

/** Parse stack settings with defaults used by RMAP and announce apply paths. */
export function parseReticulumStackSettingsPayload(raw: unknown): ReticulumStackSettingsPayload {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enable_transport: Boolean(obj.enable_transport),
    share_instance: Boolean(obj.share_instance),
    loglevel: typeof obj.loglevel === 'number' ? obj.loglevel : Number(obj.loglevel) || 4,
    announce_interval_sec: coerceAnnounceIntervalSec(obj.announce_interval_sec),
  };
}
