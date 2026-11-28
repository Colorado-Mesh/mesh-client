// fallow-ignore-file unused-class-member -- Capacitor invokes plugin methods by name (mobile/src/bridge/nativePlugins.ts)
/** Browser stand-in for the native `MeshUsbSerial` plugin (desktop Chrome uses Web Serial). */
import { WebPlugin } from '@capacitor/core';

export class WebMeshUsbSerial extends WebPlugin {
  listDevices(): Promise<{ devices: never[] }> {
    return Promise.resolve({ devices: [] });
  }
  open(): Promise<never> {
    return Promise.reject(new Error('USB serial is not available in the browser build'));
  }
}
