import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

import { ReticulumPropagationNotice } from './ReticulumPropagationNotice';

describe('ReticulumPropagationNotice', () => {
  const originalRefresh = useReticulumPropagationStore.getState().refreshFromSidecar;

  beforeEach(() => {
    useReticulumPropagationStore.setState({
      nodes: [],
      preferredId: null,
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    useReticulumPropagationStore.setState({
      nodes: [],
      preferredId: null,
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

  it('calls navigation callback when set up propagation is clicked', async () => {
    useReticulumPropagationStore.setState({ nodes: [], preferredId: null });
    const onOpen = vi.fn();
    render(<ReticulumPropagationNotice stackLive onOpenPropagationSettings={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: /propagation/i }));
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
