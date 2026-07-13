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

/** Parse stack settings with defaults used by RMAP and announce apply paths. */
export function parseReticulumStackSettingsPayload(raw: unknown): ReticulumStackSettingsPayload {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    enable_transport: Boolean(obj.enable_transport),
    share_instance: obj.share_instance !== false,
    loglevel: typeof obj.loglevel === 'number' ? obj.loglevel : Number(obj.loglevel) || 4,
    announce_interval_sec:
      typeof obj.announce_interval_sec === 'number'
        ? obj.announce_interval_sec
        : Number(obj.announce_interval_sec) || 3600,
  };
}
