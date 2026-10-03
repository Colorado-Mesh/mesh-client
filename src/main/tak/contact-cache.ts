import { EventEmitter } from 'events';

import type { TAKContact, TAKContactSource, TAKContactsUpdate } from '../../shared/tak-types';
import { MS_PER_SECOND } from '../../shared/timeConstants';

export const TAK_CONTACT_CACHE_MAX_SIZE = 2000;
/** Coalesce inbound CoT into at most one renderer update per this interval. */
export const TAK_CONTACT_FLUSH_MS = MS_PER_SECOND;
export const TAK_CONTACT_PRUNE_MS = 30 * MS_PER_SECOND;

/**
 * Latest inbound CoT contact per uid. Map order is receipt order, so eviction past the cap drops
 * the least recently heard. Emits `update` (TAKContactsUpdate) at most once per flush interval.
 */
export class TakContactCache extends EventEmitter {
  private contacts = new Map<string, TAKContact>();
  private pendingUpserts = new Map<string, TAKContact>();
  private pendingRemovals = new Set<string>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly maxSize: number = TAK_CONTACT_CACHE_MAX_SIZE) {
    super();
  }

  snapshot(now: number = Date.now()): TAKContact[] {
    this.pruneStale(now);
    return Array.from(this.contacts.values());
  }

  upsert(contact: TAKContact): void {
    this.contacts.delete(contact.uid);
    this.contacts.set(contact.uid, contact);
    this.pendingRemovals.delete(contact.uid);
    this.pendingUpserts.set(contact.uid, contact);
    for (const uid of this.contacts.keys()) {
      if (this.contacts.size <= this.maxSize) break;
      this.remove(uid);
    }
    this.ensurePruneTimer();
    this.scheduleFlush();
  }

  removeSource(source: TAKContactSource): void {
    for (const [uid, contact] of this.contacts) {
      if (contact.source === source) this.remove(uid);
    }
    this.scheduleFlush();
  }

  pruneStale(now: number = Date.now()): void {
    let removed = false;
    for (const [uid, contact] of this.contacts) {
      if (contact.staleAt <= now) {
        this.remove(uid);
        removed = true;
      }
    }
    if (removed) this.scheduleFlush();
    if (this.contacts.size === 0) this.stopPruneTimer();
  }

  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    this.stopPruneTimer();
    this.contacts.clear();
    this.pendingUpserts.clear();
    this.pendingRemovals.clear();
  }

  private remove(uid: string): void {
    if (!this.contacts.delete(uid)) return;
    this.pendingUpserts.delete(uid);
    this.pendingRemovals.add(uid);
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    if (this.pendingUpserts.size === 0 && this.pendingRemovals.size === 0) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, TAK_CONTACT_FLUSH_MS);
  }

  private flush(): void {
    if (this.pendingUpserts.size === 0 && this.pendingRemovals.size === 0) return;
    const update: TAKContactsUpdate = {
      upserts: Array.from(this.pendingUpserts.values()),
      removedUids: Array.from(this.pendingRemovals),
    };
    this.pendingUpserts.clear();
    this.pendingRemovals.clear();
    this.emit('update', update);
  }

  private ensurePruneTimer(): void {
    if (this.pruneTimer) return;
    this.pruneTimer = setInterval(() => {
      this.pruneStale();
    }, TAK_CONTACT_PRUNE_MS);
    this.pruneTimer.unref?.();
  }

  private stopPruneTimer(): void {
    if (this.pruneTimer) clearInterval(this.pruneTimer);
    this.pruneTimer = null;
  }
}
