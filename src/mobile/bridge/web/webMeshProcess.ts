// fallow-ignore-file unused-class-member -- Capacitor invokes plugin methods by name (src/mobile/bridge/nativePlugins.ts)
/**
 * Browser-harness `MeshProcess`: the bridge runs the desktop Reticulum sidecar build as a real
 * child process (MESH_SIDECAR_BIN or reticulum-sidecar/target/{debug,release}) and serves the
 * shared directory from a temporary folder, so the mobile sidecar path is exercised end to end.
 */
import { WebPlugin } from '@capacitor/core';

import { bridgeClient } from './webBridgeClient';

export class WebMeshProcess extends WebPlugin {
  constructor() {
    super();
    for (const e of ['stdout', 'stderr', 'exit']) {
      bridgeClient.on(`proc:${e}`, (data) => {
        this.notifyListeners(e, data);
      });
    }
  }
  spawn(a: unknown) {
    return bridgeClient.call('procSpawn', a);
  }
  writeStdin(a: unknown) {
    return bridgeClient.call('procWriteStdin', a);
  }
  closeStdin(a: unknown) {
    return bridgeClient.call('procCloseStdin', a);
  }
  kill(a: unknown) {
    return bridgeClient.call('procKill', a);
  }
  getSharedDir() {
    return bridgeClient.call('sharedDir', {});
  }
  sharedList(a: unknown) {
    return bridgeClient.call('sharedList', a);
  }
  sharedRead(a: unknown) {
    return bridgeClient.call('sharedRead', a);
  }
  sharedWrite(a: unknown) {
    return bridgeClient.call('sharedWrite', a);
  }
  sharedRemove(a: unknown) {
    return bridgeClient.call('sharedRemove', a);
  }
}
