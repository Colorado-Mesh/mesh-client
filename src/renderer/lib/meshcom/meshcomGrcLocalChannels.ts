/**
 * Locally opened MeshCom GRC chat tabs (not necessarily booked on the node).
 * Persisted so pills survive reload before any traffic arrives on that group.
 */

import { parseMeshcomGrcIdList } from './meshcomGrcGroups';

const STORAGE_KEY = 'mesh-client:meshcomGrcLocalChannels';

type Listener = () => void;

const listeners = new Set<Listener>();
let cached: number[] | null = null;

function readRaw(): number[] {
  if (cached) return cached;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cached = parseMeshcomGrcIdList(raw ?? '');
  } catch (e: unknown) {
    console.debug('[renderer/lib/meshcom/meshcomGrcLocalChannels] catch:', e);

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
    console.warn('mcL0877 [meshcomGrcLocalChannels] persist failed', e);
  }
  for (const listener of listeners) listener();
}

/** Subscribe to local GRC channel list changes (for React). */
export function subscribeMeshcomGrcLocalChannels(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getMeshcomGrcLocalChannels(): readonly number[] {
  return readRaw();
}

/** Add a GRC id to the local chat pill list (no-op if already present). */
export function addMeshcomGrcLocalChannel(id: number): void {
  if (!Number.isInteger(id) || id < 1 || id > 99999) return;
  const cur = readRaw();
  if (cur.includes(id)) return;
  write([...cur, id]);
}

/** Remove a GRC id from the local chat pill list. */
export function removeMeshcomGrcLocalChannel(id: number): void {
  const cur = readRaw();
  if (!cur.includes(id)) return;
  write(cur.filter((x) => x !== id));
}

/** Replace the entire local list (tests / clear). Uncapped (not device `--setgrc`). */
export function setMeshcomGrcLocalChannels(ids: readonly number[]): void {
  write(parseMeshcomGrcIdList(ids.join(';')));
}
