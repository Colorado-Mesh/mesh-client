import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp/mesh-client-test',
    getAppPath: () => '/tmp/mesh-client-test',
  },
}));

vi.mock('./log-service', () => ({
  sanitizeLogMessage: (s: string) => s,
}));

import { ReticulumSidecarManager } from './reticulum-sidecar-manager';

describe('ReticulumSidecarManager', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            status: 'ok',
            version: '0.1.0',
            rns_ready: false,
            lxmf_ready: false,
          }),
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports idle status before start', () => {
    const manager = new ReticulumSidecarManager();
    expect(manager.getStatus()).toEqual({ running: false, port: 0, pid: null });
  });

  it('resolveBinaryPath returns dev target when bundled binary missing', () => {
    const manager = new ReticulumSidecarManager();
    const resolved = manager.resolveBinaryPath();
    expect(resolved).toContain('mesh-client-reticulum');
  });
});
