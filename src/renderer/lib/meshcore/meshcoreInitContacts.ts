/**
 * initConn contact dump with stall detection.
 *
 * meshcore.js `getContacts()` resolves only on EndOfContacts and has no timeout, so one dropped
 * BLE notify frame hangs it forever. Track Contact frames as progress, fail fast on an idle gap,
 * and retry the dump once on the same link before the caller tears the transport down.
 *
 * The idle timer rejects the wrapper and drops its listener, but it does not abort
 * `getContacts()`. The retry waits until that promise settles. If it is still running when the
 * total cap expires, the caller bails and tears the link down instead of starting a second dump.
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

interface ContactsAttempt {
  result: Promise<MeshCoreContactRaw[]>;
  /** Resolves when this attempt's `getContacts()` settles, even after an idle reject. */
  dumpSettled: Promise<void>;
}

function runAttempt(
  conn: MeshcoreInitContactsConn,
  idleTimeoutMs: number,
  totalTimeoutMs: number,
  deadline: number,
): ContactsAttempt {
  let markDumpSettled: () => void = () => {};
  const dumpSettled = new Promise<void>((resolve) => {
    markDumpSettled = resolve;
  });
  const result = new Promise<MeshCoreContactRaw[]>((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      markDumpSettled();
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
        markDumpSettled();
        if (settled) return;
        cleanup();
        resolve(contacts);
      },
      (e: unknown) => {
        markDumpSettled();
        fail(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
  return { result, dumpSettled };
}

/** True when `getContacts()` settled before `deadline`. */
function waitForDumpOrDeadline(dumpSettled: Promise<void>, deadline: number): Promise<boolean> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (settled: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(settled);
    };
    const timer = setTimeout(() => {
      finish(false);
    }, remaining);
    void dumpSettled.then(() => {
      finish(true);
    });
  });
}

/** Fetch the radio contact list for initConn; one same-link retry after an idle stall. */
export async function fetchMeshcoreContactsForInit(
  conn: MeshcoreInitContactsConn,
  opts: FetchMeshcoreContactsForInitOpts,
): Promise<MeshCoreContactRaw[]> {
  const idleTimeoutMs = opts.idleTimeoutMs ?? MESHCORE_INIT_CONTACTS_IDLE_TIMEOUT_MS;
  const deadline = Date.now() + opts.totalTimeoutMs;
  const first = runAttempt(conn, idleTimeoutMs, opts.totalTimeoutMs, deadline);
  try {
    return await first.result;
  } catch (e) {
    if (!(e instanceof MeshcoreContactsStallError) || opts.isCancelled?.()) throw e;
    const dumped = await waitForDumpOrDeadline(first.dumpSettled, deadline);
    if (opts.isCancelled?.()) throw e;
    if (!dumped || deadline - Date.now() <= 0) {
      throw new Error(`getContacts timed out after ${opts.totalTimeoutMs}ms`);
    }
    opts.onStallRetry?.({ contactsBeforeStall: e.contactsBeforeStall, idleTimeoutMs });
    return await runAttempt(conn, idleTimeoutMs, opts.totalTimeoutMs, deadline).result;
  }
}
