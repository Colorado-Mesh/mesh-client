/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  deleteServingFile,
  deleteServingPage,
  encodeServingFileUpload,
  getServingStatus,
  listServingFiles,
  listServingPages,
  NOMAD_SERVING_FILE_UPLOAD_MAX_BYTES,
  pickServingContentSource,
  readServingPage,
  setServing,
  setServingContentSource,
  writeServingFile,
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
          showNomadContentSourceDialog: vi.fn(),
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
    const proxyPut = window.electronAPI.reticulum.proxyPut as ReturnType<typeof vi.fn>;
    proxyPut.mockResolvedValueOnce({
      ok: true,
      serving: { content_source: '/tmp/nomad-page', content_layout: 'site_root' },
    });
    await expect(setServingContentSource('/tmp/nomad-page')).resolves.toMatchObject({ ok: true });
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/content-source', {
      path: '/tmp/nomad-page',
    });

    proxyPut.mockResolvedValueOnce({ ok: true, serving: { content_source: null } });
    await expect(setServingContentSource(null)).resolves.toMatchObject({ ok: true });
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/content-source', {
      path: null,
    });
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

  it('lists, writes, and deletes hosted files', async () => {
    const proxyGet = window.electronAPI.reticulum.proxyGet as ReturnType<typeof vi.fn>;
    const proxyPut = window.electronAPI.reticulum.proxyPut as ReturnType<typeof vi.fn>;
    const proxyDelete = window.electronAPI.reticulum.proxyDelete as ReturnType<typeof vi.fn>;
    proxyGet.mockResolvedValueOnce({
      ok: true,
      files: [{ path: 'readme.txt', size: 4 }],
    });
    proxyPut.mockResolvedValueOnce({ ok: true });
    proxyDelete.mockResolvedValueOnce({ ok: true });

    await expect(listServingFiles()).resolves.toEqual({
      ok: true,
      files: [{ path: 'readme.txt', size: 4 }],
    });
    expect(proxyGet).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/files');

    await expect(writeServingFile('readme.txt', 'YWJjZA==')).resolves.toEqual({ ok: true });
    expect(proxyPut).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/files', {
      path: 'readme.txt',
      content_base64: 'YWJjZA==',
    });

    await expect(deleteServingFile('readme.txt')).resolves.toEqual({ ok: true });
    expect(proxyDelete).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/files?path=readme.txt');
  });

  it('rejects oversize uploads before proxying', async () => {
    const big = new File([new Uint8Array(NOMAD_SERVING_FILE_UPLOAD_MAX_BYTES + 1)], 'big.bin');
    await expect(encodeServingFileUpload(big)).resolves.toEqual({
      ok: false,
      error: 'file_too_large',
    });
  });

  it('encodes a small file for upload', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.bin', {
      type: 'application/octet-stream',
    });
    const encoded = await encodeServingFileUpload(file);
    expect(encoded).toEqual({
      ok: true,
      path: 'a.bin',
      contentBase64: btoa(String.fromCharCode(1, 2, 3)),
    });
  });
});
