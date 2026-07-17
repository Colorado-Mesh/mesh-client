/**
 * @vitest-environment jsdom
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string | number>) => {
      if (opts && 'path' in opts) return `${key}:${String(opts.path)}`;
      if (opts && 'pages' in opts) {
        return `${key}:${String(opts.pages)}/${String(opts.files)}/${String(opts.requests)}`;
      }
      return key;
    },
  }),
}));

const isReticulumSidecarRunning = vi.fn();
const onReticulumStatus = vi.fn();
const proxyGet = vi.fn();
const proxyPut = vi.fn();
const showNomadContentSourceDialog = vi.fn();
const setNomadContentSource = vi.fn();

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: () => isReticulumSidecarRunning(),
}));

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import NomadPageServerPanel from './NomadPageServerPanel';

const servingStatus = {
  enabled: true,
  running: true,
  destination_hash: 'aabbccddeeff00112233445566778899',
  identity_hash: '11223344556677889900aabbccddeeff',
  display_name: 'Home',
  page_count: 1,
  file_count: 0,
  stats: {
    request_count: 2,
    page_hits: 2,
    file_hits: 0,
    not_found_count: 0,
    last_request_ms: null,
  },
  content_root: '/tmp/nomadnetwork',
  content_source: '/tmp/nomad-page',
  content_layout: 'site_root',
  watcher_status: 'ok',
  last_error: null,
};

describe('NomadPageServerPanel', () => {
  beforeEach(() => {
    isReticulumSidecarRunning.mockResolvedValue(true);
    onReticulumStatus.mockReturnValue(() => {});
    proxyGet.mockReset();
    proxyPut.mockReset();
    showNomadContentSourceDialog.mockReset();
    setNomadContentSource.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        reticulum: {
          onStatus: onReticulumStatus,
          proxyGet,
          proxyPut,
          showNomadContentSourceDialog,
          setNomadContentSource,
        },
      },
    });
    proxyGet.mockImplementation((path: string) => {
      if (path === '/api/v1/nomadnetwork/serving') {
        return Promise.resolve({ ok: true, serving: servingStatus });
      }
      if (path === '/api/v1/nomadnetwork/serving/pages') {
        return Promise.resolve({
          ok: true,
          pages: [
            { path: 'index.mu', size: 12 },
            { path: 'about.mu', size: 8 },
          ],
        });
      }
      if (path === '/api/v1/nomadnetwork/serving/files') {
        return Promise.resolve({
          ok: true,
          files: [{ path: 'readme.txt', size: 4 }],
        });
      }
      return Promise.resolve({ ok: false, error: 'unexpected' });
    });
  });

  it('loads serving status, pages, and files when active', async () => {
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('index.mu')).toBeInTheDocument();
    });
    expect(screen.getByText('about.mu')).toBeInTheDocument();
    expect(screen.getByText('readme.txt')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Home')).toBeInTheDocument();
    expect(screen.getByText('nomadNetwork.serving.servingChip')).toBeInTheDocument();
    expect(screen.getByText('/tmp/nomad-page')).toBeInTheDocument();
  });

  it('does not expose create, edit, upload, or delete controls', async () => {
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('index.mu')).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'nomadNetwork.serving.createPage' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'nomadNetwork.serving.savePage' })).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'nomadNetwork.serving.uploadFileAria' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'nomadNetwork.serving.deletePage:about.mu' }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'nomadNetwork.serving.deleteFile:readme.txt' }),
    ).toBeNull();
    expect(screen.queryByRole('textbox', { name: /nomadNetwork.serving.editorAria/ })).toBeNull();
  });

  it('chooses a content folder via the dialog', async () => {
    const user = userEvent.setup();
    showNomadContentSourceDialog.mockResolvedValue({
      canceled: false,
      path: '/Users/me/repos/nomad-page',
    });
    setNomadContentSource.mockResolvedValue({
      ok: true,
      serving: { ...servingStatus, content_source: '/Users/me/repos/nomad-page' },
    });
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('index.mu')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.chooseFolderAria' }));
    await waitFor(() => {
      expect(setNomadContentSource).toHaveBeenCalledWith('/Users/me/repos/nomad-page');
    });
  });

  it('does not offer a clear-folder control once a content source is set', async () => {
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('/tmp/nomad-page')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: 'nomadNetwork.serving.chooseFolderAria' }),
    ).toBeTruthy();
    const labels = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? '');
    expect(labels.some((label) => /clearFolder/i.test(label))).toBe(false);
  });

  it('disables start serving until a content folder is chosen', async () => {
    proxyGet.mockImplementation((path: string) => {
      if (path === '/api/v1/nomadnetwork/serving') {
        return Promise.resolve({
          ok: true,
          serving: {
            ...servingStatus,
            running: false,
            content_source: null,
            content_layout: null,
          },
        });
      }
      if (path === '/api/v1/nomadnetwork/serving/pages') {
        return Promise.resolve({ ok: true, pages: [] });
      }
      if (path === '/api/v1/nomadnetwork/serving/files') {
        return Promise.resolve({ ok: true, files: [] });
      }
      return Promise.resolve({ ok: false, error: 'unexpected' });
    });
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('nomadNetwork.serving.contentSourceNone')).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'nomadNetwork.serving.enable' })).toBeDisabled();
  });

  it('surfaces last_error from serving status', async () => {
    proxyGet.mockImplementation((path: string) => {
      if (path === '/api/v1/nomadnetwork/serving') {
        return Promise.resolve({
          ok: true,
          serving: {
            ...servingStatus,
            running: false,
            last_error: 'content_source_unavailable',
          },
        });
      }
      if (path === '/api/v1/nomadnetwork/serving/pages') {
        return Promise.resolve({ ok: true, pages: [] });
      }
      if (path === '/api/v1/nomadnetwork/serving/files') {
        return Promise.resolve({ ok: true, files: [] });
      }
      return Promise.resolve({ ok: false, error: 'unexpected' });
    });
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('nomadNetwork.serving.contentSourceUnavailable')).toBeInTheDocument();
    });
  });

  it('invokes preview callback for the local destination', async () => {
    const user = userEvent.setup();
    const onPreviewHostedSite = vi.fn();
    render(<NomadPageServerPanel isActive onPreviewHostedSite={onPreviewHostedSite} />);
    await waitFor(() => {
      expect(screen.getByText('nomadNetwork.serving.servingChip')).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'nomadNetwork.serving.previewSiteAria' }));
    expect(onPreviewHostedSite).toHaveBeenCalledWith('aabbccddeeff00112233445566778899');
  });

  it('keeps an in-progress display name across status refresh', async () => {
    let statusListener: ((s: { running: boolean; port: number }) => void) | undefined;
    onReticulumStatus.mockImplementation((cb: (s: { running: boolean; port: number }) => void) => {
      statusListener = cb;
      return () => {};
    });
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByDisplayValue('Home')).toBeInTheDocument();
    });

    const input = screen.getByLabelText('nomadNetwork.serving.displayName');
    fireEvent.change(input, { target: { value: 'My Node' } });
    expect(input).toHaveValue('My Node');

    proxyGet.mockImplementation((path: string) => {
      if (path === '/api/v1/nomadnetwork/serving') {
        return Promise.resolve({
          ok: true,
          serving: { ...servingStatus, display_name: 'Nomad node' },
        });
      }
      if (path === '/api/v1/nomadnetwork/serving/pages') {
        return Promise.resolve({ ok: true, pages: [{ path: 'index.mu', size: 12 }] });
      }
      if (path === '/api/v1/nomadnetwork/serving/files') {
        return Promise.resolve({ ok: true, files: [] });
      }
      return Promise.resolve({ ok: false, error: 'unexpected' });
    });
    const servingCallsBefore = proxyGet.mock.calls.filter(
      (c) => c[0] === '/api/v1/nomadnetwork/serving',
    ).length;
    statusListener?.({ running: true, port: 7700 });

    await waitFor(() => {
      const servingCalls = proxyGet.mock.calls.filter(
        (c) => c[0] === '/api/v1/nomadnetwork/serving',
      ).length;
      expect(servingCalls).toBeGreaterThan(servingCallsBefore);
    });
    expect(screen.getByDisplayValue('My Node')).toBeInTheDocument();
  });

  it('surfaces pages-list errors instead of clearing them', async () => {
    proxyGet.mockImplementation((path: string) => {
      if (path === '/api/v1/nomadnetwork/serving') {
        return Promise.resolve({
          ok: true,
          serving: { ...servingStatus, running: false },
        });
      }
      if (path === '/api/v1/nomadnetwork/serving/pages') {
        return Promise.resolve({ ok: false, error: 'nomad_busy' });
      }
      if (path === '/api/v1/nomadnetwork/serving/files') {
        return Promise.resolve({ ok: true, files: [] });
      }
      return Promise.resolve({ ok: false, error: 'unexpected' });
    });
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('nomadNetwork.errors.nomadBusy')).toBeInTheDocument();
    });
  });

  it('has no axe violations for serving chip contrast', async () => {
    const { container } = render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('nomadNetwork.serving.servingChip')).toBeInTheDocument();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
