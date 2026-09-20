// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createElectronAPIMock } from '@/renderer/vitest.electronApiMock';

import { clearReticulumBleBondIssuesForOnlineInterfaces } from './clearReticulumBleBondIssuesForOnlineInterfaces';

describe('clearReticulumBleBondIssuesForOnlineInterfaces', () => {
  beforeEach(() => {
    window.electronAPI = createElectronAPIMock();
  });

  it('no-ops for empty names', async () => {
    const spy = vi.mocked(window.electronAPI.reticulum.clearBleBondIssuesForOnlineInterfaces);
    await clearReticulumBleBondIssuesForOnlineInterfaces([]);
    await clearReticulumBleBondIssuesForOnlineInterfaces(['  ', '']);
    expect(spy).not.toHaveBeenCalled();
  });

  it('dedupes and invokes IPC for online BLE names', async () => {
    const spy = vi
      .mocked(window.electronAPI.reticulum.clearBleBondIssuesForOnlineInterfaces)
      .mockResolvedValue({ running: true, port: 1, pid: 1 });
    await clearReticulumBleBondIssuesForOnlineInterfaces(['RNode 41F4', ' RNode 41F4 ', 'Other']);
    expect(spy).toHaveBeenCalledWith(['RNode 41F4', 'Other']);
  });
});
