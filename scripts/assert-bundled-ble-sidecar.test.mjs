import { describe, expect, it } from 'vitest';
import path from 'path';
import { resolveBundledSidecarPath } from './assert-bundled-ble-sidecar.mjs';

describe('assert-bundled-ble-sidecar', () => {
  it('resolves bundled sidecar paths per platform layout', () => {
    expect(resolveBundledSidecarPath('win32', '/app/win-unpacked')).toBe(
      path.join('/app/win-unpacked/resources/ble-sidecar/mesh-hub-ble.exe'),
    );
    expect(resolveBundledSidecarPath('linux', '/app/linux-unpacked')).toBe(
      path.join('/app/linux-unpacked/resources/ble-sidecar/mesh-hub-ble'),
    );
    expect(resolveBundledSidecarPath('darwin', '/app/Mesh-client.app')).toBe(
      path.join('/app/Mesh-client.app/Contents/Resources/ble-sidecar/mesh-hub-ble'),
    );
  });
});
