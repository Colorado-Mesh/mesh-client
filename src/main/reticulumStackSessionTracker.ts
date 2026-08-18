/** Tracks Reticulum stack starts so frequent client/stack restarts can surface hub fast-flap. */

import fs from 'fs';
import path from 'path';

import { MS_PER_HOUR } from '../shared/timeConstants';

/** Same count as Reticulum 1.4.0 BackboneInterface `fast_flapping_grace`. */
export const RETICULUM_STACK_FAST_FLAP_THRESHOLD = 5;

/** Same window as Reticulum 1.4.0 BackboneInterface `fast_flapping_block_time` (720 min). */
export const RETICULUM_STACK_FAST_FLAP_WINDOW_MS = 12 * MS_PER_HOUR;

const MAX_PERSISTED_SESSIONS = 32;

export interface ReticulumStackSession {
  startedAtMs: number;
  endedAtMs?: number;
}

interface PersistedStackSessions {
  sessions: ReticulumStackSession[];
}

function isFiniteMs(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parsePersistedSessions(raw: unknown): ReticulumStackSession[] {
  if (!raw || typeof raw !== 'object' || !('sessions' in raw)) {
    return [];
  }
  const sessions = (raw as PersistedStackSessions).sessions;
  if (!Array.isArray(sessions)) {
    return [];
  }
  const parsed: ReticulumStackSession[] = [];
  for (const entry of sessions) {
    if (!entry || typeof entry !== 'object') continue;
    const startedAtMs = entry.startedAtMs;
    const endedAtMs = entry.endedAtMs;
    if (!isFiniteMs(startedAtMs)) continue;
    const session: ReticulumStackSession = { startedAtMs };
    if (isFiniteMs(endedAtMs) && endedAtMs >= startedAtMs) {
      session.endedAtMs = endedAtMs;
    }
    parsed.push(session);
  }
  return parsed;
}

export class ReticulumStackSessionTracker {
  private sessions: ReticulumStackSession[] = [];

  constructor(private readonly persistPath: string | null = null) {
    this.sessions = this.load();
  }

  recordStart(nowMs = Date.now()): void {
    this.closeOpenSession(nowMs);
    this.sessions.push({ startedAtMs: nowMs });
    this.pruneAndPersist(nowMs);
  }

  recordStop(nowMs = Date.now()): void {
    if (!this.closeOpenSession(nowMs)) {
      return;
    }
    this.pruneAndPersist(nowMs);
  }

  isFastFlapSuspected(nowMs = Date.now()): boolean {
    this.prune(nowMs);
    return this.countStarts(nowMs) >= RETICULUM_STACK_FAST_FLAP_THRESHOLD;
  }

  /** Test helper — in-memory sessions after prune. */
  getSessionsForTests(nowMs = Date.now()): readonly ReticulumStackSession[] {
    this.prune(nowMs);
    return this.sessions;
  }

  private closeOpenSession(nowMs: number): boolean {
    const open = this.sessions.find((session) => session.endedAtMs == null);
    if (!open) {
      return false;
    }
    open.endedAtMs = Math.max(nowMs, open.startedAtMs);
    return true;
  }

  private countStarts(nowMs: number): number {
    return this.sessions.filter(
      (session) => nowMs - session.startedAtMs <= RETICULUM_STACK_FAST_FLAP_WINDOW_MS,
    ).length;
  }

  private prune(nowMs: number): void {
    this.sessions = this.sessions.filter(
      (session) => nowMs - session.startedAtMs <= RETICULUM_STACK_FAST_FLAP_WINDOW_MS,
    );
    if (this.sessions.length > MAX_PERSISTED_SESSIONS) {
      this.sessions = this.sessions.slice(-MAX_PERSISTED_SESSIONS);
    }
  }

  private pruneAndPersist(nowMs: number): void {
    this.prune(nowMs);
    this.save();
  }

  private load(): ReticulumStackSession[] {
    if (!this.persistPath) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      return parsePersistedSessions(JSON.parse(raw) as unknown);
    } catch {
      // catch-no-log-ok missing or corrupt session file — start empty
      return [];
    }
  }

  private save(): void {
    if (!this.persistPath) {
      return;
    }
    try {
      fs.mkdirSync(path.dirname(this.persistPath), { recursive: true });
      const payload: PersistedStackSessions = { sessions: this.sessions };
      fs.writeFileSync(this.persistPath, JSON.stringify(payload), 'utf8');
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : '';
      const message = err instanceof Error ? err.message : String(err);
      if (code === 'ENOENT') {
        console.debug('[ReticulumSidecar] stack session persist path missing:', message);
      } else {
        console.warn('[ReticulumSidecar] failed to persist stack sessions:', message);
      }
    }
  }
}
