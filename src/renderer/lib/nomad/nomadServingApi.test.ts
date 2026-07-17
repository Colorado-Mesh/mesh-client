/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteServingPage,
  getServingStatus,
  listServingPages,
  readServingPage,
  setServing,
  writeServingPage,
} from '@/renderer/lib/nomad/nomadServingApi';
import type { NomadServingStatus } from '@/shared/nomad-types';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: vi.fn(() => Promise.resolve(true)),
}));

import { isReticulumSidecarRunning } from '@/renderer/lib/reticulum/reticulumSidecarReads';

describe('nomadServingApi', () => {
  beforeEach(() => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(true);
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

  it('returns sidecar_not_running when the stack is down', async () => {
    vi.mocked(isReticulumSidecarRunning).mockResolvedValue(false);
    await expect(getServingStatus()).resolves.toEqual({
      ok: false,
      error: 'sidecar_not_running',
    });
    expect(window.electronAPI.reticulum.proxyGet).not.toHaveBeenCalled();
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

    const body = await getServingStatus();

    expect(proxyGet).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving');
    expect(body).toEqual({ ok: true, serving });
  });

  it('enables serving with display name', async () => {
    const proxyPut = window.electronAPI.reticulum.proxyPut as ReturnType<typeof vi.fn>;
    proxyPut.mockResolvedValueOnce({
      ok: true,
      serving: { enabled: true, running: true, display_name: 'Home' },
    });

    const body = await setServing({ enabled: true, displayName: 'Home' });

    expect(proxyPut).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving', {
      enabled: true,
      display_name: 'Home',
    });
    expect(body.ok).toBe(true);
  });

  it('lists pages and normalizes list errors', async () => {
    const proxyGet = window.electronAPI.reticulum.proxyGet as ReturnType<typeof vi.fn>;
    proxyGet.mockResolvedValueOnce({ ok: false, error: 'nomad_busy' });
    await expect(listServingPages()).resolves.toEqual({ ok: false, error: 'nomad_busy' });
  });

  it('reads a page via query path', async () => {
    const proxyGet = window.electronAPI.reticulum.proxyGet as ReturnType<typeof vi.fn>;
    proxyGet.mockResolvedValueOnce({ ok: true, content: '> hi' });
    const body = await readServingPage('index.mu');
    expect(proxyGet).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/page?path=index.mu');
    expect(body).toEqual({ ok: true, content: '> hi' });
  });

  it('writes and deletes pages via serving routes', async () => {
    const proxyPut = window.electronAPI.reticulum.proxyPut as ReturnType<typeof vi.fn>;
    const proxyDelete = window.electronAPI.reticulum.proxyDelete as ReturnType<typeof vi.fn>;
    proxyPut.mockResolvedValueOnce({ ok: true });
    proxyDelete.mockResolvedValueOnce({ ok: true });

    await expect(writeServingPage('about.mu', '> about')).resolves.toEqual({ ok: true });
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/pages', {
      path: 'about.mu',
      content: '> about',
    });

    await expect(deleteServingPage('about.mu')).resolves.toEqual({ ok: true });
    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/pages?path=about.mu');
  });

  it('normalizes thrown proxy errors', async () => {
    const proxyGet = window.electronAPI.reticulum.proxyGet as ReturnType<typeof vi.fn>;
    proxyGet.mockRejectedValueOnce(new Error('proxy timeout'));
    await expect(getServingStatus()).resolves.toEqual({
      ok: false,
      error: 'proxy timeout',
    });
  });
});
