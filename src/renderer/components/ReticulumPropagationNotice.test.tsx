import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { writeReticulumPropagationMode } from '@/renderer/lib/reticulum/reticulumPropagationMode';
import {
  RETICULUM_PROPAGATION_NOTICE_DISMISSED_KEY,
  useReticulumPropagationStore,
} from '@/renderer/stores/reticulumPropagationStore';

import { ReticulumPropagationNotice } from './ReticulumPropagationNotice';

const addToast = vi.fn();
vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
  pushAppToast: vi.fn(),
}));

const activeDiscovered = {
  destination_hash: 'ab'.repeat(16),
  node_state: true,
  peering_cost: 0,
  hops: 1,
};

describe('ReticulumPropagationNotice', () => {
  const originalRefresh = useReticulumPropagationStore.getState().refreshFromSidecar;

  beforeEach(() => {
    localStorage.clear();
    addToast.mockReset();
    // Off means "no propagation node wanted", so the notice only applies to Auto/Manual.
    writeReticulumPropagationMode('auto');
    useReticulumPropagationStore.setState({
      nodes: [],
      discovered: [],
      preferredId: null,
      chatNoticeDismissed: false,
      lastAddError: null,
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
      addFromDiscovered: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    useReticulumPropagationStore.setState({
      nodes: [],
      discovered: [],
      preferredId: null,
      chatNoticeDismissed: false,
      refreshFromSidecar: originalRefresh,
    });
  });

  it('shows notice when stack is live and no remote propagation target exists', () => {
    useReticulumPropagationStore.setState({
      nodes: [{ id: 'local-prop', name: 'Local', enabled: true, status: 'online' }],
      preferredId: null,
    });
    render(<ReticulumPropagationNotice stackLive onOpenPropagationSettings={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/propagation node/i);
  });

  it('hides when an effective remote propagation target exists', () => {
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'remote-1',
          name: 'Remote',
          enabled: true,
          status: 'online',
          hops: 1,
        },
      ],
      preferredId: 'remote-1',
    });
    const { container } = render(
      <ReticulumPropagationNotice stackLive onOpenPropagationSettings={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('refreshes propagation from sidecar when stack is live', async () => {
    const refreshFromSidecar = vi.fn().mockResolvedValue(undefined);
    useReticulumPropagationStore.setState({
      nodes: [],
      preferredId: null,
      refreshFromSidecar,
    });
    render(<ReticulumPropagationNotice stackLive onOpenPropagationSettings={vi.fn()} />);
    await waitFor(() => {
      expect(refreshFromSidecar).toHaveBeenCalled();
    });
  });

  it('hides in off mode even with no propagation target', () => {
    writeReticulumPropagationMode('off');
    useReticulumPropagationStore.setState({
      nodes: [{ id: 'local-prop', name: 'Local', enabled: true, status: 'online' }],
      preferredId: null,
    });
    const { container } = render(
      <ReticulumPropagationNotice stackLive onOpenPropagationSettings={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('calls navigation callback when set up propagation is clicked', async () => {
    useReticulumPropagationStore.setState({ nodes: [], preferredId: null });
    const onOpen = vi.fn();
    render(<ReticulumPropagationNotice stackLive onOpenPropagationSettings={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /open reticulum network/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  // Auto deposits on the best heard node, so a discovery is a real propagation target.
  it('hides in auto when only discovered nodes exist but still shows in manual', () => {
    useReticulumPropagationStore.setState({
      nodes: [{ id: 'local-prop', name: 'Local', enabled: true, status: 'online' }],
      discovered: [activeDiscovered],
      preferredId: null,
    });
    const { container, unmount } = render(<ReticulumPropagationNotice stackLive />);
    expect(container).toBeEmptyDOMElement();
    unmount();

    writeReticulumPropagationMode('manual');
    render(<ReticulumPropagationNotice stackLive />);
    expect(screen.getByRole('alert')).toHaveTextContent(/propagation node/i);
  });

  it('dismiss hides the notice and persists the choice', async () => {
    useReticulumPropagationStore.setState({ nodes: [], preferredId: null });
    const { container } = render(<ReticulumPropagationNotice stackLive />);
    await userEvent.click(screen.getByRole('button', { name: /stop showing/i }));
    expect(container).toBeEmptyDOMElement();
    expect(localStorage.getItem(RETICULUM_PROPAGATION_NOTICE_DISMISSED_KEY)).toBe('1');
    expect(useReticulumPropagationStore.getState().chatNoticeDismissed).toBe(true);
  });

  it('stays hidden when dismissal was restored from a previous session', () => {
    useReticulumPropagationStore.setState({
      nodes: [],
      preferredId: null,
      chatNoticeDismissed: true,
    });
    const { container } = render(<ReticulumPropagationNotice stackLive />);
    expect(container).toBeEmptyDOMElement();
  });

  it('toasts when Add closest fails', async () => {
    writeReticulumPropagationMode('manual');
    const addFromDiscovered = vi.fn().mockResolvedValue(false);
    useReticulumPropagationStore.setState({
      nodes: [],
      discovered: [activeDiscovered],
      preferredId: null,
      lastAddError: 'reticulumPropagation.addFailed',
      addFromDiscovered,
    });
    render(<ReticulumPropagationNotice stackLive />);
    await userEvent.click(
      screen.getByRole('button', {
        name: 'Add the closest discovered propagation node and set it as preferred',
      }),
    );
    expect(addFromDiscovered).toHaveBeenCalledWith(activeDiscovered.destination_hash, {
      prefer: true,
    });
    expect(addToast).toHaveBeenCalledWith('Could not add the propagation node.', 'error');
  });

  it('has no axe violations', async () => {
    writeReticulumPropagationMode('manual');
    useReticulumPropagationStore.setState({
      nodes: [],
      discovered: [activeDiscovered],
      preferredId: null,
    });
    const { container } = render(
      <ReticulumPropagationNotice stackLive onOpenPropagationSettings={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
