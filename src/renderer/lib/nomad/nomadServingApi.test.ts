/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getServingStatus,
  listServingFiles,
  listServingPages,
  pickServingContentSource,
  setServing,
  setServingContentSource,
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
          showNomadContentSourceDialog: vi.fn(),
          setNomadContentSource: vi.fn(),
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

  it('sets and clears the content source folder', async () => {
    const setSource = window.electronAPI.reticulum.setNomadContentSource as ReturnType<
      typeof vi.fn
    >;
    setSource.mockResolvedValueOnce({
      ok: true,
      serving: { content_source: '/tmp/nomad-page', content_layout: 'site_root' },
    });
    await expect(setServingContentSource('/tmp/nomad-page')).resolves.toMatchObject({ ok: true });
    expect(setSource).toHaveBeenCalledWith('/tmp/nomad-page');

    setSource.mockResolvedValueOnce({ ok: true, serving: { content_source: null } });
    await expect(setServingContentSource(null)).resolves.toMatchObject({ ok: true });
    expect(setSource).toHaveBeenCalledWith(null);
  });

  it('picks a content source directory via the main dialog', async () => {
    const dialog = window.electronAPI.reticulum.showNomadContentSourceDialog as ReturnType<
      typeof vi.fn
    >;
    dialog.mockResolvedValueOnce({ canceled: false, path: '/tmp/site' });
    await expect(pickServingContentSource()).resolves.toEqual({ ok: true, path: '/tmp/site' });
    dialog.mockResolvedValueOnce({ canceled: true, path: null });
    await expect(pickServingContentSource()).resolves.toEqual({ ok: false, canceled: true });
  });

  it('lists pages and normalizes list errors', async () => {
    const proxyGet = window.electronAPI.reticulum.proxyGet as ReturnType<typeof vi.fn>;
    proxyGet.mockResolvedValueOnce({ ok: false, error: 'nomad_busy' });
    await expect(listServingPages()).resolves.toEqual({ ok: false, error: 'nomad_busy' });
  });

  it('lists hosted files', async () => {
    const proxyGet = window.electronAPI.reticulum.proxyGet as ReturnType<typeof vi.fn>;
    proxyGet.mockResolvedValueOnce({
      ok: true,
      files: [{ path: 'readme.txt', size: 4 }],
    });

    await expect(listServingFiles()).resolves.toEqual({
      ok: true,
      files: [{ path: 'readme.txt', size: 4 }],
    });
    expect(proxyGet).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/files');
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
