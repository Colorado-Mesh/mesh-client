/**
 * initConn contact dump with stall detection.
 *
 * meshcore.js `getContacts()` resolves only on EndOfContacts and has no timeout, so one dropped
 * BLE notify frame hangs it forever. Track Contact frames as progress, fail fast on an idle gap,
 * and retry the dump once on the same link before the caller tears the transport down.
 */

import type { MeshCoreContactRaw } from '@/renderer/lib/meshcore/meshcoreHookTypes';
import { MESHCORE_INIT_CONTACTS_IDLE_TIMEOUT_MS } from '@/renderer/lib/timeConstants';

/** meshcore.js `Constants.ResponseCodes.Contact`. */
export const MESHCORE_RESPONSE_CONTACT = 3;

export interface MeshcoreInitContactsConn {
  on(event: string | number, cb: (...args: unknown[]) => void): void;
  off(event: string | number, cb: (...args: unknown[]) => void): void;
  getContacts(): Promise<MeshCoreContactRaw[]>;
}

export interface FetchMeshcoreContactsForInitOpts {
  /** Hard cap across both attempts. */
  totalTimeoutMs: number;
  idleTimeoutMs?: number;
  onStallRetry?: (info: { contactsBeforeStall: number; idleTimeoutMs: number }) => void;
  /** When true after a stall, skip the retry so a superseded setup never re-dumps on its old conn. */
  isCancelled?: () => boolean;
}

export class MeshcoreContactsStallError extends Error {
  readonly contactsBeforeStall: number;

  constructor(idleTimeoutMs: number, contactsBeforeStall: number) {
    super(
      `getContacts stalled after ${idleTimeoutMs}ms idle (${contactsBeforeStall} contacts received)`,
    );
    this.name = 'MeshcoreContactsStallError';
    this.contactsBeforeStall = contactsBeforeStall;
  }
}

function runAttempt(
  conn: MeshcoreInitContactsConn,
  idleTimeoutMs: number,
  totalTimeoutMs: number,
  deadline: number,
): Promise<MeshCoreContactRaw[]> {
  return new Promise<MeshCoreContactRaw[]>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      reject(new Error(`getContacts timed out after ${totalTimeoutMs}ms`));
      return;
    }
    let received = 0;
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      settled = true;
      conn.off(MESHCORE_RESPONSE_CONTACT, onContact);
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      clearTimeout(totalTimer);
    };
    const fail = (err: Error): void => {
      if (settled) return;
      cleanup();
      reject(err);
    };
    const armIdle = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        fail(new MeshcoreContactsStallError(idleTimeoutMs, received));
      }, idleTimeoutMs);
    };
    function onContact(): void {
      if (settled) return;
      received += 1;
      armIdle();
    }

    conn.on(MESHCORE_RESPONSE_CONTACT, onContact);
    const totalTimer = setTimeout(() => {
      fail(new Error(`getContacts timed out after ${totalTimeoutMs}ms`));
    }, remaining);
    armIdle();

    conn.getContacts().then(
      (contacts) => {
        if (settled) return;
        cleanup();
        resolve(contacts);
      },
      (e: unknown) => {
        fail(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/** Fetch the radio contact list for initConn; one same-link retry after an idle stall. */
export async function fetchMeshcoreContactsForInit(
  conn: MeshcoreInitContactsConn,
  opts: FetchMeshcoreContactsForInitOpts,
): Promise<MeshCoreContactRaw[]> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? MESHCORE_INIT_CONTACTS_IDLE_TIMEOUT_MS;
  const deadline = Date.now() + opts.totalTimeoutMs;
  try {
    return await runAttempt(conn, idleTimeoutMs, opts.totalTimeoutMs, deadline);
  } catch (e) {
    if (!(e instanceof MeshcoreContactsStallError) || opts.isCancelled?.()) throw e;
    opts.onStallRetry?.({ contactsBeforeStall: e.contactsBeforeStall, idleTimeoutMs });
    return await runAttempt(conn, idleTimeoutMs, opts.totalTimeoutMs, deadline);
  }
}
