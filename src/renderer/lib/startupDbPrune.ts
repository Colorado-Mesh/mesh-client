import { getAppSettingsRaw } from './appSettingsStorage';
import { DEFAULT_APP_SETTINGS_SHARED } from './defaultAppSettings';
import { errLikeToLogString } from './errLikeToLogString';
import { fetchMessageRetention } from './messageRetention';
import { parseStoredJson } from './parseStoredJson';
import { getStoredMeshProtocol } from './storedMeshProtocol';

let startupDbPrunePromise: Promise<void> | null = null;

/**
 * One-shot startup DB maintenance (node/message retention, migrations).
 * Single-flight per app session so unstable React deps cannot re-trigger IPC.
 */
export function runStartupDbPrune(): Promise<void> {
  if (startupDbPrunePromise) return startupDbPrunePromise;
  startupDbPrunePromise = executeStartupDbPrune();
  return startupDbPrunePromise;
}

/** @internal Vitest only — resets single-flight guard between tests. */
export function resetStartupDbPruneForTests(): void {
  startupDbPrunePromise = null;
}

async function executeStartupDbPrune(): Promise<void> {
  const startupProtocol = getStoredMeshProtocol();
  const raw =
    parseStoredJson<Record<string, unknown>>(getAppSettingsRaw(), 'App startup node pruning') ?? {};
  const s = { ...DEFAULT_APP_SETTINGS_SHARED, ...raw };
  const ops: Promise<unknown>[] = [];

  if (startupProtocol === 'meshtastic') {
    ops.push(
      window.electronAPI.db.migrateRfStubNodes().catch((e: unknown) => {
        console.warn('[App] startup migrateRfStubNodes failed ' + errLikeToLogString(e));
      }),
      window.electronAPI.db.deleteNodesNeverHeard().catch((e: unknown) => {
        console.warn('[App] startup deleteNodesNeverHeard failed ' + errLikeToLogString(e));
      }),
    );
    if (s.autoPruneEnabled) {
      const days =
        typeof s.autoPruneDays === 'number' && s.autoPruneDays > 0 ? s.autoPruneDays : 30;
      ops.push(
        window.electronAPI.db.deleteNodesByAge(days).catch((e: unknown) => {
          console.warn('[App] startup deleteNodesByAge failed ' + errLikeToLogString(e));
        }),
      );
    }
    if (s.nodeCapEnabled) {
      const cap = typeof s.nodeCapCount === 'number' && s.nodeCapCount > 0 ? s.nodeCapCount : 10000;
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
  } else if (startupProtocol === 'meshcore') {
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
          : 5000;
      ops.push(
        window.electronAPI.db.pruneMeshcoreContactsByCount(cap).catch((e: unknown) => {
          console.warn(
            '[App] startup pruneMeshcoreContactsByCount failed ' + errLikeToLogString(e),
          );
        }),
      );
    }
  }

  ops.push(
    window.electronAPI.db.vacuumReticulumTables().catch((e: unknown) => {
      console.warn('[App] startup vacuumReticulumTables failed ' + errLikeToLogString(e));
    }),
  );

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
                  '[App] startup pruneMeshcoreMessagesByCount failed ' + errLikeToLogString(e),
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
}
