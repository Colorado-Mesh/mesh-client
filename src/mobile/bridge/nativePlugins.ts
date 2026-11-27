/**
 * Capacitor plugin access by name for the mobile host bridge. The host worker cannot reach
 * Capacitor (plugins live on the UI thread), so it asks for `plugin.method(args)` by name.
 *
 * Web fallbacks (browser test harness, `pnpm run mobile:dev`) are registered for the custom
 * mesh plugins; the community plugins ship their own web implementations.
 */
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';

export type AnyPlugin = Record<string, unknown> & {
  addListener?: (event: string, cb: (data: unknown) => void) => Promise<PluginListenerHandle>;
};

/** Lazily create one instance per web plugin (Capacitor calls the loader for every method). */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let instance: Promise<T> | null = null;
  return () => (instance ??= load());
}

const WEB_IMPLEMENTATIONS: Record<string, () => Promise<unknown>> = {
  MeshNet: once(() => import('./web/webMeshNet').then((m) => new m.WebMeshNet())),
  MeshProcess: once(() => import('./web/webMeshProcess').then((m) => new m.WebMeshProcess())),
  MeshDevice: once(() => import('./web/webMeshDevice').then((m) => new m.WebMeshDevice())),
  MeshUsbSerial: once(() => import('./web/webMeshUsbSerial').then((m) => new m.WebMeshUsbSerial())),
};

const cache = new Map<string, AnyPlugin>();

export function getPlugin(name: string): AnyPlugin {
  let p = cache.get(name);
  if (!p) {
    const existing = (Capacitor as unknown as { Plugins?: Record<string, AnyPlugin> }).Plugins?.[
      name
    ];
    const web = WEB_IMPLEMENTATIONS[name] as (() => Promise<unknown>) | undefined;
    p = existing ?? registerPlugin<AnyPlugin>(name, { web });
    cache.set(name, p);
  }
  return p;
}

export async function callPlugin(plugin: string, method: string, arg: unknown): Promise<unknown> {
  const p = getPlugin(plugin);
  const fn = p[method];
  if (typeof fn !== 'function')
    throw new Error(`${plugin}.${method} is not implemented on this platform`);
  return await (fn as (a: unknown) => Promise<unknown>).call(p, arg ?? {});
}

export async function listenPlugin(
  plugin: string,
  event: string,
  cb: (data: unknown) => void,
): Promise<PluginListenerHandle> {
  const p = getPlugin(plugin);
  if (typeof p.addListener !== 'function') throw new Error(`${plugin} has no listeners`);
  return await p.addListener(event, cb);
}

export function mobilePlatform(): 'android' | 'ios' | 'web' {
  const p = Capacitor.getPlatform();
  return p === 'android' || p === 'ios' ? p : 'web';
}
