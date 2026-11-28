import type { IpcMainInvokeEvent } from 'electron';

import type { ReachCheckApi, ReachCheckResult } from '../../shared/reachCheck';
import {
  createReachCheckClient,
  defaultReachCheckTransport,
  errorText,
  isLocalReachCheckAllowed,
} from '../reach-check';

/** MeshCore reach check IPC. Ships as sibling `reach-check-handlers.js` (outside the index.js budget). */
export const REACH_CHECK_IPC_CHANNELS = [
  'reachCheck:bootstrap',
  'reachCheck:createSession',
  'reachCheck:getSession',
] as const;

type ReachCheckChannel = (typeof REACH_CHECK_IPC_CHANNELS)[number];

export interface ReachCheckIpcDeps {
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
    ) => void;
  };
  assertIpcSender: (event: IpcMainInvokeEvent, channel: string) => void;
  /** Injected in tests; otherwise the real HTTPS client. */
  client?: ReachCheckApi;
  /**
   * `app.isPackaged`. Local test servers are allowed only when this is false and
   * `MESH_CLIENT_REACH_CHECK_LOCAL=1`; a missing value counts as packaged.
   */
  isPackaged?: boolean;
  env?: NodeJS.ProcessEnv;
}

const INVALID_URL: ReachCheckResult<never> = { ok: false, error: 'invalid_url' };
const NETWORK: ReachCheckResult<never> = { ok: false, error: 'network' };

export function registerReachCheckIpcHandlers(deps: ReachCheckIpcDeps): void {
  const client =
    deps.client ??
    createReachCheckClient({
      request: defaultReachCheckTransport,
      allowLocal: isLocalReachCheckAllowed(deps.env ?? process.env, deps.isPackaged !== false),
      now: () => Date.now(),
    });

  const { ipcMain, assertIpcSender } = deps;

  /** `call` is null when the arguments are not strings; the client is never reached then. */
  const run = async (
    channel: ReachCheckChannel,
    call: (() => Promise<ReachCheckResult<unknown>>) | null,
  ): Promise<ReachCheckResult<unknown>> => {
    if (!call) return INVALID_URL;
    try {
      return await call();
    } catch (e: unknown) {
      console.debug('[main/ipc/reach-check-handlers] %s failed: %s', channel, errorText(e));
      return NETWORK;
    }
  };

  // Literal channel names keep `check:ipc-contract` able to pair them with the preload.
  ipcMain.handle('reachCheck:bootstrap', async (event, origin: unknown) => {
    assertIpcSender(event, 'reachCheck:bootstrap');
    return run(
      'reachCheck:bootstrap',
      typeof origin === 'string' ? () => client.bootstrap(origin) : null,
    );
  });
  ipcMain.handle('reachCheck:createSession', async (event, origin: unknown) => {
    assertIpcSender(event, 'reachCheck:createSession');
    return run(
      'reachCheck:createSession',
      typeof origin === 'string' ? () => client.createSession(origin) : null,
    );
  });
  ipcMain.handle('reachCheck:getSession', async (event, origin: unknown, id: unknown) => {
    assertIpcSender(event, 'reachCheck:getSession');
    return run(
      'reachCheck:getSession',
      typeof origin === 'string' && typeof id === 'string'
        ? () => client.getSession(origin, id)
        : null,
    );
  });
}
