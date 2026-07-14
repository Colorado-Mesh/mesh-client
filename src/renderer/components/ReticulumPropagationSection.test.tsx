import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => (opts?.name ? `${key}:${opts.name}` : key),
  }),
}));

vi.mock('./ReticulumPropagationSyncProgress', () => ({
  ReticulumPropagationLastRefreshed: () => null,
  ReticulumPropagationRefreshButton: () => null,
  ReticulumPropagationSyncProgress: () => null,
}));

vi.mock('./ConfirmModal', () => ({
  ConfirmModal: ({
    title,
    message,
    confirmLabel,
    onConfirm,
    onCancel,
  }: {
    title: string;
    message: string;
    confirmLabel: string;
    onConfirm: () => void;
    onCancel: () => void;
  }) => (
    <div role="dialog" aria-label={title}>
      <p>{message}</p>
      <button type="button" onClick={onConfirm}>
        {confirmLabel}
      </button>
      <button type="button" onClick={onCancel}>
        cancel
      </button>
    </div>
  ),
}));

import ReticulumPropagationSection from './ReticulumPropagationSection';

describe('ReticulumPropagationSection', () => {
  const original = {
    refreshFromSidecar: useReticulumPropagationStore.getState().refreshFromSidecar,
    removePropagationNode: useReticulumPropagationStore.getState().removePropagationNode,
    renamePropagationNode: useReticulumPropagationStore.getState().renamePropagationNode,
    setPreferredOnSidecar: useReticulumPropagationStore.getState().setPreferredOnSidecar,
    setAutoSyncIntervalOnSidecar:
      useReticulumPropagationStore.getState().setAutoSyncIntervalOnSidecar,
    startSync: useReticulumPropagationStore.getState().startSync,
    addPropagationNode: useReticulumPropagationStore.getState().addPropagationNode,
  };

  beforeEach(() => {
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Local propagation (offline inbox)',
          enabled: true,
          status: 'known',
          hops: 0,
        },
        {
          id: 'pn-aabb1111',
          name: 'Remote hub',
          enabled: true,
          status: 'known',
          destination_hash: 'aabb1111222233334444555566667777',
        },
      ],
      preferredId: null,
      sync: { active: false, progress: 0, message: null },
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
      removePropagationNode: vi.fn().mockResolvedValue(true),
      renamePropagationNode: vi.fn().mockResolvedValue(true),
      setPreferredOnSidecar: vi.fn().mockResolvedValue(true),
      setAutoSyncIntervalOnSidecar: vi.fn().mockResolvedValue(true),
      startSync: vi.fn().mockResolvedValue(true),
      addPropagationNode: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    useReticulumPropagationStore.setState(original);
  });

  it('shows rename and delete for remote nodes only', () => {
    render(<ReticulumPropagationSection embedded />);

    expect(
      screen.getByRole('button', { name: 'reticulumPropagation.renameAria:Remote hub' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'reticulumPropagation.deleteAria:Remote hub' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /reticulumPropagation\.renameAria:Local propagation/,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: /reticulumPropagation\.deleteAria:Local propagation/,
      }),
    ).not.toBeInTheDocument();
  });

  it('confirms delete and calls removePropagationNode', async () => {
    const user = userEvent.setup();
    const removePropagationNode = vi.mocked(
      useReticulumPropagationStore.getState().removePropagationNode,
    );

    render(<ReticulumPropagationSection embedded />);

    await user.click(
      screen.getByRole('button', { name: 'reticulumPropagation.deleteAria:Remote hub' }),
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'reticulumPropagation.deleteConfirm' }));

    await waitFor(() => {
      expect(removePropagationNode).toHaveBeenCalledWith('pn-aabb1111');
    });
  });

  it('saves renamed display name', async () => {
    const user = userEvent.setup();
    const renamePropagationNode = vi.mocked(
      useReticulumPropagationStore.getState().renamePropagationNode,
    );

    render(<ReticulumPropagationSection embedded />);

    await user.click(
      screen.getByRole('button', { name: 'reticulumPropagation.renameAria:Remote hub' }),
    );
    const input = screen.getByLabelText('reticulumPropagation.renameLabel');
    await user.clear(input);
    await user.type(input, 'Office PN');
    await user.click(screen.getByRole('button', { name: 'reticulumPropagation.renameSave' }));

    await waitFor(() => {
      expect(renamePropagationNode).toHaveBeenCalledWith('pn-aabb1111', 'Office PN');
    });
  });
});
