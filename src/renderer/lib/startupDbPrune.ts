import { MS_PER_DAY } from '@/shared/timeConstants';

import { getAppSettingsRaw } from './appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { errLikeToLogString } from './errLikeToLogString';
import { fetchMessageRetention, RRC_MESSAGE_RETENTION_DEFAULT_AGE_DAYS } from './messageRetention';
import { parseStoredJson } from './parseStoredJson';
import { MAX_MESH_ENTITY_CAP, SESSION_DB_PRUNE_INTERVAL_MS } from './sessionMemoryCaps';

let startupDbPrunePromise: Promise<void> | null = null;
let sessionDbPrunePromise: Promise<void> | null = null;
let reticulumVacuumScheduled = false;

export { SESSION_DB_PRUNE_INTERVAL_MS };

/** At most one idle VACUUM per this interval (localStorage gate). */
const RETICULUM_VACUUM_MIN_INTERVAL_MS = 7 * MS_PER_DAY;
const RETICULUM_VACUUM_LAST_MS_KEY = 'mesh-client:lastReticulumVacuumMs';

/**
 * Schedule a Reticulum table VACUUM after first paint / idle — never on the cold-start
 * prune path. Single-flight per session; skipped if vacuumed within the last 7 days.
 */
export function scheduleReticulumVacuumIfNeeded(): void {
  if (reticulumVacuumScheduled) return;
  if (typeof window === 'undefined' || !window.electronAPI?.db?.vacuumReticulumTables) return;

  let lastMs = 0;
  try {
    const raw = localStorage.getItem(RETICULUM_VACUUM_LAST_MS_KEY);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) lastMs = n;
    }
  } catch {
    // catch-no-log-ok localStorage may be unavailable in tests
  }
  if (Date.now() - lastMs < RETICULUM_VACUUM_MIN_INTERVAL_MS) return;

  reticulumVacuumScheduled = true;
  const run = (): void => {
    void window.electronAPI.db
      .vacuumReticulumTables()
      .then(() => {
        try {
          localStorage.setItem(RETICULUM_VACUUM_LAST_MS_KEY, String(Date.now()));
        } catch {
          // catch-no-log-ok
        }
      })
      .catch((e: unknown) => {
        console.warn('[App] idle vacuumReticulumTables failed ' + errLikeToLogString(e));
      });
  };

  const ric = (
    window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }
  ).requestIdleCallback;
  if (typeof ric === 'function') {
    ric(run, { timeout: 60_000 });
  } else {
    setTimeout(run, 30_000);
  }
}

/** @internal Vitest only */
export function resetReticulumVacuumScheduleForTests(): void {
  reticulumVacuumScheduled = false;
}

/**
 * One-shot startup DB maintenance (node/message retention, migrations).
 * Single-flight per app session so unstable React deps cannot re-trigger IPC.
 */
export function runStartupDbPrune(): Promise<void> {
  if (startupDbPrunePromise) return startupDbPrunePromise;
  startupDbPrunePromise = executeDbPrune('startup');
  return startupDbPrunePromise;
}

/** Periodic maintenance while the app stays connected (same ops as startup prune). */
export function runSessionDbPrune(): Promise<void> {
  if (sessionDbPrunePromise) return sessionDbPrunePromise;
  sessionDbPrunePromise = executeDbPrune('session').finally(() => {
    sessionDbPrunePromise = null;
  });
  return sessionDbPrunePromise;
}

/** @internal Vitest only — resets single-flight guard between tests. */
export function resetStartupDbPruneForTests(): void {
  startupDbPrunePromise = null;
  sessionDbPrunePromise = null;
}

async function executeDbPrune(label: 'startup' | 'session'): Promise<void> {
  const raw =
    parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), 'App startup node pruning') ?? {};
  const s = { ...DEFAULT_APP_SETTINGS_SHARED, ...raw };
  const ops: Promise<unknown>[] = [];

  // Retention runs for all protocols every startup/session — not only the last-active tab.
  ops.push(
    window.electronAPI.db.migrateRfStubNodes().catch((e: unknown) => {
      console.warn('[App] startup migrateRfStubNodes failed ' + errLikeToLogString(e));
    }),
    window.electronAPI.db.deleteNodesNeverHeard().catch((e: unknown) => {
      console.warn('[App] startup deleteNodesNeverHeard failed ' + errLikeToLogString(e));
    }),
  );
  if (s.autoPruneEnabled) {
    const days = typeof s.autoPruneDays === 'number' && s.autoPruneDays > 0 ? s.autoPruneDays : 30;
    ops.push(
      window.electronAPI.db.deleteNodesByAge(days).catch((e: unknown) => {
        console.warn('[App] startup deleteNodesByAge failed ' + errLikeToLogString(e));
      }),
    );
  }
  if (s.nodeCapEnabled) {
    const cap =
      typeof s.nodeCapCount === 'number' && s.nodeCapCount > 0
        ? s.nodeCapCount
        : MAX_MESH_ENTITY_CAP;
    ops.push(
      window.electronAPI.db.pruneNodesByCount(cap).catch((e: unknown) => {
        console.warn('[App] startup pruneNodesByCount failed ' + errLikeToLogString(e));
      }),
    );
  }
  if (s.pruneEmptyNamesEnabled) {
    ops.push(
      window.electronAPI.db.deleteNodesWithoutLongname().catch((e: unknown) => {
        console.warn('[App] startup deleteNodesWithoutLongname failed ' + errLikeToLogString(e));
      }),
    );
  }
  if (s.positionHistoryPruneEnabled) {
    const days =
      typeof s.positionHistoryPruneDays === 'number' && s.positionHistoryPruneDays > 0
        ? s.positionHistoryPruneDays
        : 30;
    ops.push(
      window.electronAPI.db.prunePositionHistory(days).catch((e: unknown) => {
        console.warn('[App] startup prunePositionHistory failed ' + errLikeToLogString(e));
      }),
      window.electronAPI.db.prunePositionHistoryPerNode(2000).catch((e: unknown) => {
        console.warn('[App] startup prunePositionHistoryPerNode failed ' + errLikeToLogString(e));
      }),
    );
  }

  if (s.meshcoreDeleteNeverAdvertised) {
    ops.push(
      window.electronAPI.db.deleteMeshcoreContactsNeverAdvertised().catch((e: unknown) => {
        console.warn(
          '[App] startup deleteMeshcoreContactsNeverAdvertised failed ' + errLikeToLogString(e),
        );
      }),
    );
  }
  if (s.meshcoreAutoPruneEnabled) {
    const days =
      typeof s.meshcoreAutoPruneDays === 'number' && s.meshcoreAutoPruneDays > 0
        ? s.meshcoreAutoPruneDays
        : 30;
    ops.push(
      window.electronAPI.db.deleteMeshcoreContactsByAge(days).catch((e: unknown) => {
        console.warn('[App] startup deleteMeshcoreContactsByAge failed ' + errLikeToLogString(e));
      }),
    );
  }
  if (s.meshcoreContactCapEnabled) {
    const cap =
      typeof s.meshcoreContactCapCount === 'number' && s.meshcoreContactCapCount > 0
        ? s.meshcoreContactCapCount
        : MAX_MESH_ENTITY_CAP;
    ops.push(
      window.electronAPI.db.pruneMeshcoreContactsByCount(cap).catch((e: unknown) => {
        console.warn('[App] startup pruneMeshcoreContactsByCount failed ' + errLikeToLogString(e));
      }),
    );
  }

  if (s.reticulumAutoPruneEnabled) {
    const days =
      typeof s.reticulumAutoPruneDays === 'number' && s.reticulumAutoPruneDays > 0
        ? s.reticulumAutoPruneDays
        : 30;
    ops.push(
      window.electronAPI.db.deleteReticulumDestinationsByAge(days).catch((e: unknown) => {
        console.warn(
          `[App] ${label} deleteReticulumDestinationsByAge failed ` + errLikeToLogString(e),
        );
      }),
      window.electronAPI.db.pruneReticulumIdentityActivityByAge(days).catch((e: unknown) => {
        console.warn(
          `[App] ${label} pruneReticulumIdentityActivityByAge failed ` + errLikeToLogString(e),
        );
      }),
    );
  }
  if (s.reticulumDestinationCapEnabled) {
    const cap =
      typeof s.reticulumDestinationCapCount === 'number' && s.reticulumDestinationCapCount > 0
        ? Math.min(50_000, s.reticulumDestinationCapCount)
        : DEFAULT_APP_SETTINGS_SHARED.reticulumDestinationCapCount;
    ops.push(
      window.electronAPI.db.pruneReticulumDestinationsByCount(cap).catch((e: unknown) => {
        console.warn(
          `[App] ${label} pruneReticulumDestinationsByCount failed ` + errLikeToLogString(e),
        );
      }),
    );
  }

  ops.push(
    fetchMessageRetention()
      .then((r) => {
        const innerOps: Promise<unknown>[] = [];
        if (r.meshtasticEnabled) {
          innerOps.push(
            window.electronAPI.db.pruneMessagesByCount(r.meshtasticCount).catch((e: unknown) => {
              console.warn('[App] startup pruneMessagesByCount failed ' + errLikeToLogString(e));
            }),
          );
        }
        if (r.meshcoreEnabled) {
          innerOps.push(
            window.electronAPI.db
              .pruneMeshcoreMessagesByCount(r.meshcoreCount)
              .catch((e: unknown) => {
                console.warn(
                  `[App] ${label} pruneMeshcoreMessagesByCount failed ` + errLikeToLogString(e),
                );
              }),
          );
        }
        if (r.reticulumEnabled) {
          innerOps.push(
            window.electronAPI.db
              .pruneReticulumMessagesByCount(r.reticulumCount)
              .catch((e: unknown) => {
                console.warn(
                  `[App] ${label} pruneReticulumMessagesByCount failed ` + errLikeToLogString(e),
                );
              }),
          );
        }
        if (r.rrcEnabled) {
          innerOps.push(
            window.electronAPI.db.pruneRrcMessagesByCount(r.rrcCount).catch((e: unknown) => {
              console.warn(
                `[App] ${label} pruneRrcMessagesByCount failed ` + errLikeToLogString(e),
              );
            }),
            window.electronAPI.db
              .pruneRrcMessagesByAge(RRC_MESSAGE_RETENTION_DEFAULT_AGE_DAYS)
              .catch((e: unknown) => {
                console.warn(
                  `[App] ${label} pruneRrcMessagesByAge failed ` + errLikeToLogString(e),
                );
              }),
          );
        }
        return Promise.all(innerOps);
      })
      .catch((e: unknown) => {
        console.warn('[App] startup message retention prune failed ' + errLikeToLogString(e));
      }),
  );

  if (ops.length > 0) {
    await Promise.all(ops);
  }

  // VACUUM is intentionally not part of cold-start prune — it rewrites the whole DB and
  // dominated Reticulum startups (~1s). Use scheduleReticulumVacuumIfNeeded() after prune
  // that deleted rows, or idle/manual maintenance.
}
