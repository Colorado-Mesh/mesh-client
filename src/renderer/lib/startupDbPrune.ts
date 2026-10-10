import { getAppSettingsRaw } from './appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { errLikeToLogString } from './errLikeToLogString';
import { fetchMessageRetention } from './messageRetention';
import { parseStoredJson } from './parseStoredJson';
import { MAX_MESH_ENTITY_CAP, SESSION_DB_PRUNE_INTERVAL_MS } from './sessionMemoryCaps';

let startupDbPrunePromise: Promise<void> | null = null;
let sessionDbPrunePromise: Promise<void> | null = null;

export { SESSION_DB_PRUNE_INTERVAL_MS };

export interface DbPruneOptions {
  /** Node ids whose position history is kept regardless of age/per-node caps (open incidents). */
  exemptNodeIds?: ReadonlySet<string> | readonly string[];
}

/**
 * One-shot startup DB maintenance (node/message retention, migrations).
 * Single-flight per app session so unstable React deps cannot re-trigger IPC;
 * options from later calls while in flight are ignored.
 */
export function runStartupDbPrune(opts?: DbPruneOptions): Promise<void> {
  if (startupDbPrunePromise) return startupDbPrunePromise;
  startupDbPrunePromise = executeDbPrune('startup', opts);
  return startupDbPrunePromise;
}

/** Periodic maintenance while the app stays connected (same ops as startup prune). */
export function runSessionDbPrune(opts?: DbPruneOptions): Promise<void> {
  if (sessionDbPrunePromise) return sessionDbPrunePromise;
  sessionDbPrunePromise = executeDbPrune('session', opts).finally(() => {
    sessionDbPrunePromise = null;
  });
  return sessionDbPrunePromise;
}

/** @internal Vitest only — resets single-flight guard between tests. */
export function resetStartupDbPruneForTests(): void {
  startupDbPrunePromise = null;
  sessionDbPrunePromise = null;
}

async function executeDbPrune(label: 'startup' | 'session', opts?: DbPruneOptions): Promise<void> {
  const raw =
    parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), 'App startup node pruning') ?? {};
  const s = { ...DEFAULT_APP_SETTINGS_SHARED, ...raw };
  const ops: Promise<unknown>[] = [];

  // Retention runs for all protocols every startup/session — not only the last-active tab.
  ops.push(
    window.electronAPI.db.migrateRfStubNodes().catch((e: unknown) => {
      console.warn(`[App] ${label} migrateRfStubNodes failed ` + errLikeToLogString(e));
    }),
    window.electronAPI.db.deleteNodesNeverHeard().catch((e: unknown) => {
      console.warn(`[App] ${label} deleteNodesNeverHeard failed ` + errLikeToLogString(e));
    }),
  );
  if (s.autoPruneEnabled) {
    const days = typeof s.autoPruneDays === 'number' && s.autoPruneDays > 0 ? s.autoPruneDays : 30;
    ops.push(
      window.electronAPI.db.deleteNodesByAge(days).catch((e: unknown) => {
        console.warn(`[App] ${label} deleteNodesByAge failed ` + errLikeToLogString(e));
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
        console.warn(`[App] ${label} pruneNodesByCount failed ` + errLikeToLogString(e));
      }),
    );
  }
  if (s.pruneEmptyNamesEnabled) {
    ops.push(
      window.electronAPI.db.deleteNodesWithoutLongname().catch((e: unknown) => {
        console.warn(`[App] ${label} deleteNodesWithoutLongname failed ` + errLikeToLogString(e));
      }),
    );
  }
  if (s.positionHistoryPruneEnabled) {
    const days =
      typeof s.positionHistoryPruneDays === 'number' && s.positionHistoryPruneDays > 0
        ? s.positionHistoryPruneDays
        : 30;
    const exempt = opts?.exemptNodeIds ? [...opts.exemptNodeIds] : [];
    const prunePosition =
      exempt.length > 0
        ? window.electronAPI.db.prunePositionHistory(days, exempt)
        : window.electronAPI.db.prunePositionHistory(days);
    const prunePositionPerNode =
      exempt.length > 0
        ? window.electronAPI.db.prunePositionHistoryPerNode(2000, exempt)
        : window.electronAPI.db.prunePositionHistoryPerNode(2000);
    ops.push(
      prunePosition.catch((e: unknown) => {
        console.warn(`[App] ${label} prunePositionHistory failed ` + errLikeToLogString(e));
      }),
      prunePositionPerNode.catch((e: unknown) => {
        console.warn(`[App] ${label} prunePositionHistoryPerNode failed ` + errLikeToLogString(e));
      }),
    );
  }

  ops.push(
    window.electronAPI.db.pruneEnvironmentTelemetry().catch((e: unknown) => {
      console.warn(`[App] ${label} pruneEnvironmentTelemetry failed ` + errLikeToLogString(e));
    }),
  );

  if (s.meshcoreDeleteNeverAdvertised) {
    ops.push(
      window.electronAPI.db.deleteMeshcoreContactsNeverAdvertised().catch((e: unknown) => {
        console.warn(
          `[App] ${label} deleteMeshcoreContactsNeverAdvertised failed ` + errLikeToLogString(e),
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
        console.warn(`[App] ${label} deleteMeshcoreContactsByAge failed ` + errLikeToLogString(e));
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
        console.warn(`[App] ${label} pruneMeshcoreContactsByCount failed ` + errLikeToLogString(e));
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
              console.warn(`[App] ${label} pruneMessagesByCount failed ` + errLikeToLogString(e));
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
        return Promise.all(innerOps);
      })
      .catch((e: unknown) => {
        console.warn(`[App] ${label} message retention prune failed ` + errLikeToLogString(e));
      }),
  );

  if (ops.length > 0) {
    await Promise.all(ops);
  }
}
