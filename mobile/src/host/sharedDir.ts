/**
 * Directory shared by the host (Electron main code) and the Reticulum sidecar process.
 *
 * On desktop both use `<userData>/reticulum` on disk. On mobile main's `fs` is a virtual volume,
 * so the sidecar gets a real directory from the native `MeshProcess` plugin and:
 * - sidecar arguments under `/data/user/reticulum` are rewritten to that real path;
 * - the config subtree (`config/`, the Reticulum INI that main edits before start and the sidecar
 *   edits through its API) is mirrored: main's writes are pushed to the real file (awaited before
 *   every spawn), and the real files are pulled into the virtual volume at boot, every
 *   `PULL_INTERVAL_MS` while the sidecar runs, and when it exits.
 * The sidecar's `storage/` (keys, path table, LXMF store) is sidecar-private and not mirrored.
 *
 * Failure handling: push/pull errors are logged and retried on the next change / pull; the real
 * file is replaced atomically by the native side, so an interrupted push leaves the old config.
 */
import { Buffer } from 'buffer';

import { callNative } from './hostChannel';
import {
  readVirtualFile,
  removeVirtualSilently,
  virtualPathKind,
  writeVirtualSilently,
} from './shims/node/fs';

const SHARED_VIRTUAL_ROOT = '/data/user/reticulum';
const MIRRORED_SUBTREES = ['config'];
const PULL_INTERVAL_MS = 10_000;

let realRoot: string | null = null;
const pendingPush = new Set<string>();
let pushing: Promise<void> = Promise.resolve();
let pullTimer: ReturnType<typeof setInterval> | null = null;

function relative(p: string): string | null {
  if (p === SHARED_VIRTUAL_ROOT) return '';
  if (!p.startsWith(`${SHARED_VIRTUAL_ROOT}/`)) return null;
  return p.slice(SHARED_VIRTUAL_ROOT.length + 1);
}

/** True for virtual paths mirrored to the real shared dir (owned here, not by OPFS). */
export function isMirroredPath(p: string): boolean {
  const rel = relative(p);
  if (rel === null || realRoot === null) return false;
  return MIRRORED_SUBTREES.some((sub) => rel === sub || rel.startsWith(`${sub}/`));
}

/** Rewrite a sidecar argument from the virtual shared root to the real directory. */
export function mapSharedArg(arg: string): string {
  if (realRoot === null) return arg;
  const rel = relative(arg);
  return rel === null ? arg : rel === '' ? realRoot : `${realRoot}/${rel}`;
}

export function queueSharedPush(p: string): void {
  pendingPush.add(p);
  pushing = pushing.then(drainPushes, drainPushes);
}

async function drainPushes(): Promise<void> {
  const paths = [...pendingPush];
  pendingPush.clear();
  for (const p of paths) {
    const rel = relative(p);
    if (rel === null) continue;
    try {
      const kind = virtualPathKind(p);
      // Directories exist implicitly on the native side (sharedWrite creates parents).
      if (kind === 'dir') continue;
      const bytes = kind === 'file' ? readVirtualFile(p) : null;
      if (bytes) {
        await callNative('MeshProcess', 'sharedWrite', {
          path: rel,
          dataB64: Buffer.from(bytes).toString('base64'),
        });
      } else if (kind === 'missing') {
        await callNative('MeshProcess', 'sharedRemove', { path: rel });
      }
    } catch (e) {
      pendingPush.add(p);
      console.error(
        `mcM0009 [mobile/shared] push failed for ${rel}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Wait for every pending push (called before the sidecar starts). */
export async function flushSharedPushes(): Promise<void> {
  pushing = pushing.then(drainPushes, drainPushes);
  await pushing;
}

/** Copy the mirrored subtrees from the real dir into the virtual volume. */
async function pullShared(): Promise<void> {
  if (realRoot === null) return;
  for (const sub of MIRRORED_SUBTREES) {
    try {
      const { files } = await callNative<{ files: { path: string }[] }>(
        'MeshProcess',
        'sharedList',
        { path: sub },
      );
      const seen = new Set<string>();
      for (const f of files) {
        const virtual = `${SHARED_VIRTUAL_ROOT}/${f.path}`;
        seen.add(virtual);
        if (pendingPush.has(virtual)) continue; // local edit not pushed yet wins
        const { dataB64 } = await callNative<{ dataB64: string }>('MeshProcess', 'sharedRead', {
          path: f.path,
        });
        writeVirtualSilently(virtual, Uint8Array.from(Buffer.from(dataB64, 'base64')));
      }
      removeVirtualSilently(
        `${SHARED_VIRTUAL_ROOT}/${sub}`,
        (p) => !seen.has(p) && !pendingPush.has(p),
      );
    } catch (e) {
      console.error(
        `mcM0010 [mobile/shared] pull failed for ${sub}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}

/** Resolve the real shared dir and load the mirrored config. Call once at boot. */
export async function initSharedDir(): Promise<void> {
  const { path } = await callNative<{ path: string }>('MeshProcess', 'getSharedDir');
  realRoot = path.replace(/\/+$/, '');
  await pullShared();
}

export function startSharedPull(): void {
  if (pullTimer) return;
  pullTimer = setInterval(() => {
    void pullShared();
  }, PULL_INTERVAL_MS);
}

export function stopSharedPull(): void {
  if (pullTimer) clearInterval(pullTimer);
  pullTimer = null;
  void pullShared();
}
