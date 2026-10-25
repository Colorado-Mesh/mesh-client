import { beforeEach, describe, expect, it, vi } from 'vitest';

import { exportSupportBundleToDisk } from './exportSupportBundle';

const sampleCoiMemoryNow = vi.fn();
const buildDebugSnapshotAsync = vi.fn();

vi.mock('./coiMemorySampler', () => ({
  sampleCoiMemoryNow: (...args: unknown[]) => sampleCoiMemoryNow(...args),
}));

vi.mock('./debugSnapshot', () => ({
  buildDebugSnapshotAsync: (...args: unknown[]) => buildDebugSnapshotAsync(...args),
}));

describe('exportSupportBundleToDisk', () => {
  beforeEach(() => {
    sampleCoiMemoryNow.mockReset();
    buildDebugSnapshotAsync.mockReset();
    vi.mocked(window.electronAPI.support.exportBundle).mockReset();
    vi.mocked(window.electronAPI.support.exportBundle).mockResolvedValue('/tmp/bundle.zip');
    sampleCoiMemoryNow.mockResolvedValue({ at: 1, bytes: 2 });
    buildDebugSnapshotAsync.mockResolvedValue({
      rendererMemory: {
        crossOriginIsolated: true,
        supported: true,
        sampling: false,
        failed: false,
        samples: [{ at: 1, bytes: 2 }],
      },
    });
  });

  it.each(['github', 'developer'] as const)(
    'samples renderer memory before building the %s support bundle',
    async (mode) => {
      const order: string[] = [];
      sampleCoiMemoryNow.mockImplementation(() => {
        order.push('sample');
        return Promise.resolve({ at: 1, bytes: 2 });
      });
      buildDebugSnapshotAsync.mockImplementation(() => {
        order.push('snapshot');
        return Promise.resolve({
          rendererMemory: {
            crossOriginIsolated: true,
            supported: true,
            sampling: false,
            failed: false,
            samples: [{ at: 1, bytes: 2 }],
          },
        });
      });
      vi.mocked(window.electronAPI.support.exportBundle).mockImplementation(() => {
        order.push('export');
        return Promise.resolve('/tmp/bundle.zip');
      });

      const path = await exportSupportBundleToDisk(mode);

      expect(path).toBe('/tmp/bundle.zip');
      expect(order).toEqual(['sample', 'snapshot', 'export']);
      expect(window.electronAPI.support.exportBundle).toHaveBeenCalledWith(
        mode,
        expect.stringContaining('"rendererMemory"'),
      );
    },
  );

  it('still exports when memory sampling returns null', async () => {
    sampleCoiMemoryNow.mockResolvedValue(null);
    await expect(exportSupportBundleToDisk('github')).resolves.toBe('/tmp/bundle.zip');
    expect(buildDebugSnapshotAsync).toHaveBeenCalledOnce();
    expect(window.electronAPI.support.exportBundle).toHaveBeenCalledWith(
      'github',
      expect.stringContaining('"rendererMemory"'),
    );
  });
});
