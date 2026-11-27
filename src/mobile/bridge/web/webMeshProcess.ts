// fallow-ignore-file unused-class-member -- Capacitor invokes plugin methods by name (src/mobile/bridge/nativePlugins.ts)
/** Browser stand-in for the native `MeshProcess` plugin: no child processes in a browser. */
import { WebPlugin } from '@capacitor/core';

export class WebMeshProcess extends WebPlugin {
  spawn(): Promise<never> {
    return Promise.reject(new Error('Child processes are not available in the browser build'));
  }
  writeStdin(): Promise<void> {
    return Promise.resolve();
  }
  closeStdin(): Promise<void> {
    return Promise.resolve();
  }
  kill(): Promise<void> {
    return Promise.resolve();
  }
}
