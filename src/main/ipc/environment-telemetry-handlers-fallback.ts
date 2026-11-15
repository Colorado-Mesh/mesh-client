import type { IpcMain, IpcMainInvokeEvent } from 'electron';

export interface EnvironmentTelemetryIpcFallbackDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  assertIpcSender: (event: IpcMainInvokeEvent, channel: string) => void;
}

/** Channels registered by {@link registerEnvironmentTelemetryIpcHandlers} (preload must stay in sync). */
const ENVIRONMENT_TELEMETRY_IPC_CHANNELS = [
  'db:saveEnvironmentTelemetry',
  'db:getEnvironmentTelemetry',
  'db:claimLegacyEnvironmentTelemetryIdentity',
  'db:clearEnvironmentTelemetry',
  'db:pruneEnvironmentTelemetry',
] as const;

/**
 * Lightweight IPC stubs when `environment-telemetry-handlers.js` fails to load.
 * Env history is non-critical — return empty / zero-change results instead of throwing.
 */
export function registerEnvironmentTelemetryIpcFallbackHandlers(
  deps: EnvironmentTelemetryIpcFallbackDeps,
): void {
  const { ipcMain, assertIpcSender } = deps;
  for (const channel of ENVIRONMENT_TELEMETRY_IPC_CHANNELS) {
    ipcMain.handle(channel, (event) => {
      assertIpcSender(event, channel);
      if (channel === 'db:getEnvironmentTelemetry') return [];
      if (channel === 'db:pruneEnvironmentTelemetry') return 0;
      return { changes: 0 };
    });
  }
}
