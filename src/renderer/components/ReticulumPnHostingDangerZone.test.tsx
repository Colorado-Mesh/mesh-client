import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';
import { DEFAULT_PN_HOSTING_POLICY } from '@/shared/pnHostingPolicy';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const addToast = vi.fn();
vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
}));

import ReticulumPnHostingDangerZone from './ReticulumPnHostingDangerZone';

describe('ReticulumPnHostingDangerZone', () => {
  const original = {
    hostingPolicy: useReticulumPropagationStore.getState().hostingPolicy,
    refreshFromSidecar: useReticulumPropagationStore.getState().refreshFromSidecar,
    setHostingPolicyOnSidecar: useReticulumPropagationStore.getState().setHostingPolicyOnSidecar,
  };

  beforeEach(() => {
    addToast.mockReset();
    useReticulumPropagationStore.setState({
      hostingPolicy: { ...DEFAULT_PN_HOSTING_POLICY },
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
      setHostingPolicyOnSidecar: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    useReticulumPropagationStore.setState(original);
  });

  it('renders yellow danger zone and saves hosting policy payload', async () => {
    const user = userEvent.setup();
    const setHostingPolicyOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setHostingPolicyOnSidecar,
    );

    render(<ReticulumPnHostingDangerZone />);

    expect(screen.getByText('networkPanel.reticulumPnHosting.title')).toBeInTheDocument();

    const maxPeering = screen.getByLabelText('networkPanel.reticulumPnHosting.maxPeeringCost');
    await user.clear(maxPeering);
    await user.type(maxPeering, '30');

    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPnHosting.saveAria' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPnHosting.saveConfirm' }),
    );

    await waitFor(() => {
      expect(setHostingPolicyOnSidecar).toHaveBeenCalled();
    });
    const saved = setHostingPolicyOnSidecar.mock.calls[0]?.[0];
    expect(saved?.max_peering_cost).toBe(30);
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('networkPanel.reticulumPnHosting.saveOk', 'success');
    });
  });

  it('toasts failure when save fails', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      setHostingPolicyOnSidecar: vi.fn().mockResolvedValue(false),
      lastHostingPolicyError: 'networkPanel.reticulumPnHosting.saveFailed',
    });

    render(<ReticulumPnHostingDangerZone />);
    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPnHosting.saveAria' }),
    );
    await user.click(
      screen.getByRole('button', { name: 'networkPanel.reticulumPnHosting.saveConfirm' }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('networkPanel.reticulumPnHosting.saveFailed', 'error');
    });
  });
});
