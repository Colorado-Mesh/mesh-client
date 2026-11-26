/**
 * GRC ids the user removed from the MeshCom chat strip.
 * Persisted so history-discovered pills do not reappear until the group is opened again.
 */

import { parseMeshcomGrcIdList } from './meshcomGrcGroups';

const STORAGE_KEY = 'mesh-client:meshcomGrcHiddenChannels';

export type Listener = () => void;

const listeners = new Set<Listener>();
let cached: number[] | null = null;

function readRaw(): number[] {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = parseMeshcomGrcIdList(raw ?? '');
  } catch (e: unknown) {
    console.debug('[renderer/lib/meshcom/meshcomGrcHiddenChannels] catch:', e);
    cached = [];
  }
  return cached;
}

function write(ids: number[]): void {
  cached = ids;
  try {
    if (ids.length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, ids.join(';'));
    }
  } catch (e) {
    console.warn('mcL1507 [meshcomGrcHiddenChannels] persist failed', e);
  }
  for (const listener of listeners) listener();
}

/** Subscribe to hidden GRC id list changes (for React). */
export function subscribeMeshcomGrcHiddenChannels(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMeshcomGrcHiddenChannels(): readonly number[] {
  return readRaw();
}

export function isMeshcomGrcHiddenChannel(id: number): boolean {
  return readRaw().includes(id);
}

/** Hide a GRC id from chat pills (no-op if already hidden or invalid). */
export function hideMeshcomGrcChannel(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > 99999) return;
  const cur = readRaw();
  if (cur.includes(id)) return;
  write([...cur, id]);
}

/** Clear a hide tombstone so the id can appear from local/history/listen again. */
export function unhideMeshcomGrcChannel(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > 99999) return;
  const cur = readRaw();
  if (!cur.includes(id)) return;
  write(cur.filter((x) => x !== id));
}

/** Replace the entire hidden list (tests / clear). */
export function setMeshcomGrcHiddenChannels(ids: readonly number[]): void {
  write(parseMeshcomGrcIdList(ids.join(';')));
}
