/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from '@testing-library/react';
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
const proxyDelete = vi.fn();

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
};

describe('NomadPageServerPanel', () => {
  beforeEach(() => {
    isReticulumSidecarRunning.mockResolvedValue(true);
    onReticulumStatus.mockReturnValue(() => {});
    proxyGet.mockReset();
    proxyPut.mockReset();
    proxyDelete.mockReset();
    Object.defineProperty(window, 'electronAPI', {
      configurable: true,
      value: {
        reticulum: {
          onStatus: onReticulumStatus,
          proxyGet,
          proxyPut,
          proxyDelete,
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
      if (path.startsWith('/api/v1/nomadnetwork/serving/page?')) {
        return Promise.resolve({ ok: true, content: '> hi' });
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

  it('deletes a hosted file', async () => {
    const user = userEvent.setup();
    proxyDelete.mockResolvedValue({ ok: true });
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('readme.txt')).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole('button', { name: 'nomadNetwork.serving.deleteFile:readme.txt' }),
    );
    await waitFor(() => {
      expect(proxyDelete).toHaveBeenCalledWith(
        '/api/v1/nomadnetwork/serving/files?path=readme.txt',
      );
    });
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

  it('disables delete for index.mu and deletes other pages', async () => {
    const user = userEvent.setup();
    proxyDelete.mockResolvedValue({ ok: true });
    render(<NomadPageServerPanel isActive />);
    await waitFor(() => {
      expect(screen.getByText('index.mu')).toBeInTheDocument();
    });

    const indexDelete = screen.getByRole('button', {
      name: 'nomadNetwork.serving.deletePage:index.mu',
    });
    expect(indexDelete).toBeDisabled();

    await user.click(
      screen.getByRole('button', { name: 'nomadNetwork.serving.deletePage:about.mu' }),
    );
    await waitFor(() => {
      expect(proxyDelete).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/pages?path=about.mu');
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
