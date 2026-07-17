/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NomadServingStatus } from '@/shared/nomad-types';

describe('nomad serving API contract', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        reticulum: {
          proxyGet: vi.fn(),
          proxyPut: vi.fn(),
          proxyDelete: vi.fn(),
        },
      },
    });
  });

  it('reads serving status from sidecar', async () => {
    const serving: NomadServingStatus = {
      enabled: true,
      running: true,
      destination_hash: 'aabbccddeeff00112233445566778899',
      identity_hash: '11223344556677889900aabbccddeeff',
      display_name: 'Test Node',
      page_count: 1,
      file_count: 0,
      stats: {
        request_count: 0,
        page_hits: 0,
        file_hits: 0,
        not_found_count: 0,
        last_request_ms: null,
      },
      content_root: '/tmp/nomadnetwork',
    };
    const proxyGet = window.electronAPI.reticulum.proxyGet as ReturnType<typeof vi.fn>;
    proxyGet.mockResolvedValueOnce({ ok: true, serving });

    const body = (await window.electronAPI.reticulum.proxyGet('/api/v1/nomadnetwork/serving')) as {
      ok: boolean;
      serving: NomadServingStatus;
    };

    expect(proxyGet).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving');
    expect(body.serving.running).toBe(true);
    expect(body.serving.destination_hash).toHaveLength(32);
  });

  it('enables serving with display name', async () => {
    const proxyPut = window.electronAPI.reticulum.proxyPut as ReturnType<typeof vi.fn>;
    proxyPut.mockResolvedValueOnce({
      ok: true,
      serving: { enabled: true, running: true, display_name: 'Home' },
    });

    await window.electronAPI.reticulum.proxyPut('/api/v1/nomadnetwork/serving', {
      enabled: true,
      display_name: 'Home',
    });

    expect(proxyPut).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving', {
      enabled: true,
      display_name: 'Home',
    });
  });

  it('deletes pages via query path', async () => {
    const proxyDelete = window.electronAPI.reticulum.proxyDelete as ReturnType<typeof vi.fn>;
    proxyDelete.mockResolvedValueOnce({ ok: true });
    const qs = new URLSearchParams({ path: 'about.mu' });
    await window.electronAPI.reticulum.proxyDelete(
      `/api/v1/nomadnetwork/serving/pages?${qs.toString()}`,
    );
    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/pages?path=about.mu');
  });
});
