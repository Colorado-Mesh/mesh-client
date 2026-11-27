/**
 * Test helper: connects the host worker's native-call channel to an in-process MeshNet bridge
 * session (`scripts/mobile-web-bridge.mjs`), so the Node/Electron shims can be exercised against
 * the reference implementation of the native plugin contract without a WebView.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { bindPort, handleUiMessage, setBootConfig } from '../hostChannel';
import type { HostToUiMessage } from '../protocol';

interface BridgeSession {
  handle(op: string, args: unknown): Promise<unknown>;
  close(): void;
}

export async function connectHostToBridge(): Promise<{ close(): void }> {
  const mod = (await import(
    pathToFileURL(path.resolve(__dirname, '../../../../scripts/mobile-web-bridge.mjs')).href
  )) as { createBridgeSession(emit: (event: string, data: unknown) => void): BridgeSession };
  const listened = new Set<string>();
  const session = mod.createBridgeSession((event, data) => {
    if (!listened.has(event)) return;
    handleUiMessage({ t: 'nativeEvent', plugin: 'MeshNet', event, data });
  });
  setBootConfig({
    mobilePlatform: 'android',
    nodePlatform: 'linux',
    appVersion: '0.0.0-test',
    safeStorageKeyHex: '11'.repeat(32),
    locale: 'en-US',
    rendererUrl: 'mesh-client://renderer/index.html',
  });
  bindPort((msg: HostToUiMessage) => {
    if (msg.t !== 'native') return;
    const arg = msg.args[0];
    if (msg.method === '__addListener') {
      listened.add((arg as { event: string }).event);
      return;
    }
    if (msg.plugin !== 'MeshNet') {
      queueMicrotask(() => {
        handleUiMessage({
          t: 'nativeResult',
          id: msg.id,
          ok: false,
          error: { name: 'Error', message: `${msg.plugin} not available in tests` },
        });
      });
      return;
    }
    session.handle(msg.method, arg).then(
      (value) => {
        handleUiMessage({ t: 'nativeResult', id: msg.id, ok: true, value });
      },
      (e: unknown) => {
        handleUiMessage({
          t: 'nativeResult',
          id: msg.id,
          ok: false,
          error: { name: 'Error', message: e instanceof Error ? e.message : String(e) },
        });
      },
    );
  });
  return {
    close: () => {
      session.close();
    },
  };
}
