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
    <div role="alertdialog" aria-label={title}>
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

const addToast = vi.fn();
vi.mock('./Toast', () => ({
  useToast: () => ({ addToast }),
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
    addToast.mockReset();
    localStorage.clear();
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Host propagation node',
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
      discovered: [],
      sync: { active: false, progress: 0, message: null },
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
      removePropagationNode: vi.fn().mockResolvedValue(true),
      renamePropagationNode: vi.fn().mockResolvedValue(true),
      setPreferredOnSidecar: vi.fn().mockResolvedValue(true),
      setAutoSyncIntervalOnSidecar: vi.fn().mockResolvedValue(true),
      startSync: vi.fn().mockResolvedValue(true),
      addPropagationNode: vi.fn().mockResolvedValue(true),
      addFromDiscovered: vi.fn().mockResolvedValue(true),
    });
  });

  afterEach(() => {
    useReticulumPropagationStore.setState(original);
  });

  it('shows rename and delete for remote nodes only', () => {
    render(<ReticulumPropagationSection embedded />);

    expect(screen.getByText(/reticulumPropagation\.localHostName/)).toBeInTheDocument();
    expect(screen.getByText('reticulumPropagation.localHostHint')).toBeInTheDocument();
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

  it('warns when preferring local-only propagation', async () => {
    const user = userEvent.setup();
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    render(<ReticulumPropagationSection embedded />);
    const preferButtons = screen.getAllByRole('button', {
      name: 'reticulumPropagation.setPreferred',
    });
    const localPrefer = preferButtons.at(0);
    if (!localPrefer) {
      throw new Error('expected Set preferred control for local-prop');
    }
    await user.click(localPrefer);
    await waitFor(() => {
      expect(setPreferredOnSidecar).toHaveBeenCalledWith('local-prop');
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'reticulumPropagation.preferredLocalWarning',
        'warning',
      );
    });
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
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'reticulumPropagation.deleteConfirm' }));

    await waitFor(() => {
      expect(removePropagationNode).toHaveBeenCalledWith('pn-aabb1111');
    });
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  it('keeps delete confirm open and toasts when remove fails', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      removePropagationNode: vi.fn().mockResolvedValue(false),
    });

    render(<ReticulumPropagationSection embedded />);

    await user.click(
      screen.getByRole('button', { name: 'reticulumPropagation.deleteAria:Remote hub' }),
    );
    await user.click(screen.getByRole('button', { name: 'reticulumPropagation.deleteConfirm' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('reticulumPropagation.deleteFailed', 'error');
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
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
    await user.click(screen.getByRole('button', { name: 'reticulumPropagation.renameSaveAria' }));

    await waitFor(() => {
      expect(renamePropagationNode).toHaveBeenCalledWith('pn-aabb1111', 'Office PN');
    });
  });

  it('toasts and keeps rename editor when rename fails', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      renamePropagationNode: vi.fn().mockResolvedValue(false),
    });

    render(<ReticulumPropagationSection embedded />);

    await user.click(
      screen.getByRole('button', { name: 'reticulumPropagation.renameAria:Remote hub' }),
    );
    const input = screen.getByLabelText('reticulumPropagation.renameLabel');
    await user.clear(input);
    await user.type(input, 'Office PN');
    await user.click(screen.getByRole('button', { name: 'reticulumPropagation.renameSaveAria' }));

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('reticulumPropagation.renameFailed', 'error');
    });
    expect(screen.getByLabelText('reticulumPropagation.renameLabel')).toBeInTheDocument();
  });

  it('toasts when set preferred fails', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      setPreferredOnSidecar: vi.fn().mockResolvedValue(false),
    });

    render(<ReticulumPropagationSection embedded />);

    await user.click(
      screen.getAllByRole('button', { name: 'reticulumPropagation.setPreferred' })[0],
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('reticulumPropagation.setPreferredFailed', 'error');
    });
  });

  it('shows probing progress while add runs and surfaces offer-unsupported toast', async () => {
    const user = userEvent.setup();
    let resolveAdd!: (ok: boolean) => void;
    const addPropagationNode = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveAdd = resolve;
        }),
    );
    useReticulumPropagationStore.setState({
      addPropagationNode,
      lastAddError: null,
    });

    render(<ReticulumPropagationSection embedded />);

    const hashInput = screen.getByLabelText('reticulumPropagation.addNodeLabel');
    await user.type(hashInput, 'aabb1111222233334444555566667777');
    await user.click(screen.getByRole('button', { name: 'reticulumPropagation.addNode' }));

    expect(await screen.findByRole('status')).toHaveTextContent('reticulumPropagation.addProbing');
    expect(addPropagationNode).toHaveBeenCalledWith('aabb1111222233334444555566667777');

    useReticulumPropagationStore.setState({
      lastAddError: 'reticulumPropagation.offerUnsupported',
    });
    resolveAdd(false);

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('reticulumPropagation.offerUnsupported', 'error');
    });
  });

  it('defaults to Off: no auto preferred write and Set preferred enabled', () => {
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    render(<ReticulumPropagationSection embedded />);

    const modeSelect = screen.getByLabelText<HTMLSelectElement>('reticulumPropagation.modeAria');
    expect(modeSelect.value).toBe('off');
    expect(setPreferredOnSidecar).not.toHaveBeenCalled();
    for (const btn of screen.getAllByRole('button', {
      name: 'reticulumPropagation.setPreferred',
    })) {
      expect(btn).not.toBeDisabled();
    }
    expect(
      screen.getByRole('button', { name: 'reticulumPropagation.syncNowPreferredAria' }),
    ).toBeDisabled();
  });

  it('Auto picks the best remote and gates manual preferred controls', async () => {
    const user = userEvent.setup();
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'auto');

    await waitFor(() => {
      expect(setPreferredOnSidecar).toHaveBeenCalledWith('pn-aabb1111');
    });
    for (const btn of screen.getAllByRole('button', {
      name: 'reticulumPropagation.setPreferred',
    })) {
      expect(btn).toBeDisabled();
    }
  });

  it('Auto falls back to local when no remote is enabled', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Host propagation node',
          enabled: true,
          status: 'known',
          hops: 0,
        },
      ],
      preferredId: null,
    });
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'auto');

    await waitFor(() => {
      expect(setPreferredOnSidecar).toHaveBeenCalledWith('local-prop');
    });
  });

  it('Manual keeps Set preferred usable and does not auto-write', async () => {
    const user = userEvent.setup();
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    expect(setPreferredOnSidecar).not.toHaveBeenCalled();

    const remotePrefer = screen
      .getAllByRole('button', { name: 'reticulumPropagation.setPreferred' })
      .at(-1);
    if (!remotePrefer) throw new Error('expected a Set preferred control');
    await user.click(remotePrefer);
    await waitFor(() => {
      expect(setPreferredOnSidecar).toHaveBeenCalledWith('pn-aabb1111');
    });
  });
});
