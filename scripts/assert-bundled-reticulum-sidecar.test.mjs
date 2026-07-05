import { describe, expect, it } from 'vitest';
import path from 'path';
import { resolveBundledSidecarPath } from './assert-bundled-reticulum-sidecar.mjs';

describe('assert-bundled-reticulum-sidecar', () => {
  it('resolves bundled sidecar paths per platform layout', () => {
    expect(resolveBundledSidecarPath('win32', '/app/win-unpacked')).toBe(
      path.join('/app/win-unpacked/resources/reticulum-sidecar/mesh-client-reticulum.exe'),
    );
    expect(resolveBundledSidecarPath('linux', '/app/linux-unpacked')).toBe(
      path.join('/app/linux-unpacked/resources/reticulum-sidecar/mesh-client-reticulum'),
    );
    expect(resolveBundledSidecarPath('darwin', '/app/Mesh-client.app')).toBe(
      path.join('/app/Mesh-client.app/Contents/Resources/reticulum-sidecar/mesh-client-reticulum'),
    );
  });
});
