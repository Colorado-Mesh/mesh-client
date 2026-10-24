import { RENDERER_HOST, RENDERER_SCHEME } from './rendererOrigin';

export const RENDERER_STORAGE_DELETION_STATE_MAX_LENGTH = 16 * 1024;

export interface PendingRendererStorageIntent {
  id: string;
  origin: string;
  deleted: boolean;
}

export interface RendererStorageDeletionState {
  deleted: boolean;
  applied: Record<string, string>;
  imported: Record<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Node's URL.origin is opaque for Electron's custom scheme. */
export function rendererStorageIntentOrigin(href: string): string {
  const url = new URL(href);
  if (url.protocol === 'file:') return 'file:';
  if (
    url.protocol === `${RENDERER_SCHEME}:` &&
    url.hostname === RENDERER_HOST &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  ) {
    return `${RENDERER_SCHEME}://${RENDERER_HOST}`;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
  throw new TypeError('Unsupported renderer storage intent origin');
}

function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 512) return false;
  try {
    return rendererStorageIntentOrigin(value) === value;
  } catch {
    // catch-no-log-ok malformed persisted origins are rejected by the caller.
    return false;
  }
}

function isIntentId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

/** Preserve the originating identity when a pending journal crosses renderer origins. */
export function parseRendererStorageIntent(raw: string): PendingRendererStorageIntent {
  if (raw === '0' || raw === '1') {
    return { id: `legacy:${raw}`, origin: 'file:', deleted: raw === '1' };
  }
  if (raw.length > RENDERER_STORAGE_DELETION_STATE_MAX_LENGTH) {
    throw new RangeError('Renderer storage deletion intent exceeds size limit');
  }
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    !isIntentId(value.id) ||
    !isOrigin(value.origin) ||
    typeof value.deleted !== 'boolean'
  ) {
    throw new TypeError('Invalid renderer storage deletion intent');
  }
  return { id: value.id, origin: value.origin, deleted: value.deleted };
}

/** The canonical flag and its per-origin receipts are committed in one SQLite value. */
export function parseRendererStorageDeletionState(
  raw: string | undefined,
): RendererStorageDeletionState {
  if (raw === undefined) return { deleted: false, applied: {}, imported: {} };
  if (raw === '0' || raw === '1') return { deleted: raw === '1', applied: {}, imported: {} };
  if (raw.length > RENDERER_STORAGE_DELETION_STATE_MAX_LENGTH) {
    throw new RangeError('Canonical renderer storage deletion state exceeds size limit');
  }
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value) ||
    typeof value.deleted !== 'boolean' ||
    !isRecord(value.applied) ||
    !Object.entries(value.applied).every(([origin, id]) => isOrigin(origin) && isIntentId(id)) ||
    (value.imported !== undefined &&
      (!isRecord(value.imported) ||
        !Object.entries(value.imported).every(
          ([origin, id]) => isOrigin(origin) && isIntentId(id),
        )))
  ) {
    throw new TypeError('Invalid canonical renderer storage deletion state');
  }
  return {
    deleted: value.deleted,
    applied: value.applied as Record<string, string>,
    imported: (value.imported ?? {}) as Record<string, string>,
  };
}

/** A copied migration journal remains consumed even after its origin applies a newer edit. */
export function hasAppliedRendererStorageIntent(
  state: RendererStorageDeletionState,
  intent: PendingRendererStorageIntent,
): boolean {
  return state.applied[intent.origin] === intent.id || state.imported[intent.origin] === intent.id;
}
