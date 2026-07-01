import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RETICULUM_PROPAGATION_MODE_KEY } from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

import { ReticulumPropagationControls } from './ReticulumPropagationControls';

describe('ReticulumPropagationControls', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.removeItem(RETICULUM_PROPAGATION_MODE_KEY);
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Local',
          hops: 0,
          enabled: true,
          status: 'known',
        },
        {
          id: 'pn-aaaa1111',
          name: 'Near node',
          hops: 1,
          enabled: true,
          status: 'known',
        },
      ],
      preferredId: null,
      sync: { active: false, progress: 0, message: null },
    });
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockResolvedValue({
      propagation: useReticulumPropagationStore.getState().nodes,
      preferred_id: null,
    });
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockResolvedValue({ ok: true });
  });

  it('renders mode selector and sync button when sidecar is ready', () => {
    render(<ReticulumPropagationControls sidecarReady />);

    expect(screen.getByLabelText('reticulumPropagationHeader.modeAria')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'reticulumPropagationHeader.syncAria' }),
    ).toBeInTheDocument();
  });

  it('starts sync with auto-picked node in auto mode', async () => {
    const user = userEvent.setup();
    const proxyPost = vi.mocked(window.electronAPI.reticulum.proxyPost);

    render(<ReticulumPropagationControls sidecarReady />);

    await user.click(screen.getByRole('button', { name: 'reticulumPropagationHeader.syncAria' }));

    await waitFor(() => {
      expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/pn-aaaa1111/preferred', {});
      expect(proxyPost).toHaveBeenCalledWith('/api/v1/propagation/sync', {
        propagation_id: 'pn-aaaa1111',
      });
    });
  });

  it('disables sync in off mode', () => {
    localStorage.setItem(RETICULUM_PROPAGATION_MODE_KEY, 'off');
    render(<ReticulumPropagationControls sidecarReady />);

    expect(
      screen.getByRole('button', { name: 'reticulumPropagationHeader.syncAria' }),
    ).toBeDisabled();
  });

  it('disables controls when sidecar is not ready', () => {
    render(<ReticulumPropagationControls sidecarReady={false} />);

    expect(screen.getByLabelText('reticulumPropagationHeader.modeAria')).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'reticulumPropagationHeader.syncAria' }),
    ).toBeDisabled();
  });
});
