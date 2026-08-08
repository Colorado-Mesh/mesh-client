import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RETICULUM_PROPAGATION_NOTICE_DISMISSED_KEY,
  useReticulumPropagationStore,
} from '@/renderer/stores/reticulumPropagationStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => (opts?.name ? `${key}:${opts.name}` : key),
  }),
}));

vi.mock('./ReticulumPropagationSyncProgress', async () => {
  const actual = await vi.importActual('./ReticulumPropagationSyncProgress');
  return {
    ...(actual as Record<string, unknown>),
    ReticulumPropagationLastRefreshed: () => null,
    ReticulumPropagationRefreshButton: () => null,
    ReticulumPropagationSyncProgress: () => null,
  };
});

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
  pushAppToast: vi.fn(),
}));

vi.mock('@/renderer/lib/i18n', () => ({
  default: { t: (key: string) => key },
}));

import { resetPropagationSyncCascadeState } from '@/renderer/lib/reticulum/reticulumPropagationAutoApply';
import { RETICULUM_PROPAGATION_MODE_KEY } from '@/renderer/lib/reticulum/reticulumPropagationMode';
import { resetReticulumPropagationSyncFailures } from '@/renderer/lib/reticulum/reticulumPropagationSyncBackoff';

import ReticulumPropagationSection from './ReticulumPropagationSection';

describe('ReticulumPropagationSection', () => {
  const original = {
    refreshFromSidecar: useReticulumPropagationStore.getState().refreshFromSidecar,
    removePropagationNode: useReticulumPropagationStore.getState().removePropagationNode,
    renamePropagationNode: useReticulumPropagationStore.getState().renamePropagationNode,
    setPreferredOnSidecar: useReticulumPropagationStore.getState().setPreferredOnSidecar,
    setAutoSyncIntervalOnSidecar:
      useReticulumPropagationStore.getState().setAutoSyncIntervalOnSidecar,
    setModeOnSidecar: useReticulumPropagationStore.getState().setModeOnSidecar,
    startSync: useReticulumPropagationStore.getState().startSync,
    addPropagationNode: useReticulumPropagationStore.getState().addPropagationNode,
  };

  beforeEach(() => {
    addToast.mockReset();
    localStorage.clear();
    resetPropagationSyncCascadeState();
    resetReticulumPropagationSyncFailures();
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
      syncTargetId: null,
      lastSyncError: null,
      chatNoticeDismissed: false,
      propagationMode: 'off',
      refreshFromSidecar: vi.fn().mockResolvedValue(undefined),
      removePropagationNode: vi.fn().mockResolvedValue(true),
      renamePropagationNode: vi.fn().mockResolvedValue(true),
      setPreferredOnSidecar: vi.fn().mockResolvedValue(true),
      setAutoSyncIntervalOnSidecar: vi.fn().mockResolvedValue(true),
      setModeOnSidecar: vi.fn().mockResolvedValue(true),
      startSync: vi.fn().mockResolvedValue('accepted'),
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

  it('Manual with Preferred local enables bottom Sync and settles local', async () => {
    const user = userEvent.setup();
    const startSync = vi.fn().mockResolvedValue('accepted');
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
      preferredId: 'local-prop',
      startSync,
    });
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    const bottomSync = screen.getByRole('button', {
      name: 'reticulumPropagation.syncNowPreferredAria',
    });
    expect(bottomSync).not.toBeDisabled();
    await user.click(bottomSync);
    await waitFor(() => {
      expect(startSync).toHaveBeenCalledWith('local-prop');
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

  it('Auto does not write Preferred or gate Set preferred', async () => {
    const user = userEvent.setup();
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'auto');

    await waitFor(() => {
      expect(setPreferredOnSidecar).not.toHaveBeenCalled();
    });
    for (const btn of screen.getAllByRole('button', {
      name: 'reticulumPropagation.setPreferred',
    })) {
      expect(btn).not.toBeDisabled();
    }
  });

  it('Auto one-time syncs best discovered by hash without Add or Preferred', async () => {
    const user = userEvent.setup();
    const hash = 'deadbeef'.repeat(4);
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
      discovered: [
        {
          destination_hash: hash,
          display_name: 'Discovered PN',
          node_state: true,
          peering_cost: 0,
          hops: 1,
        },
      ],
    });
    const addFromDiscovered = vi.mocked(useReticulumPropagationStore.getState().addFromDiscovered);
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    const startSync = vi.mocked(useReticulumPropagationStore.getState().startSync);
    // Cascade probes interfaces; report one enabled so discovered sync is attempted.
    vi.mocked(window.electronAPI.reticulum.proxyGet).mockImplementation((path: string) => {
      if (path === '/api/v1/interfaces') {
        return Promise.resolve({ interfaces: [{ id: 'tcp1', enabled: true }] });
      }
      return Promise.resolve({ status: 'ok' });
    });
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'auto');

    await waitFor(() => {
      expect(startSync).toHaveBeenCalledWith(hash.toLowerCase());
    });
    expect(addFromDiscovered).not.toHaveBeenCalled();
    expect(setPreferredOnSidecar).not.toHaveBeenCalled();
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

  it('Sync Now in Auto syncs configured remote without Preferred write', async () => {
    const user = userEvent.setup();
    // Start in Auto so mode change does not auto-kick an extra cascade before the click.
    useReticulumPropagationStore.getState().setPropagationMode('auto');
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    const startSync = vi.mocked(useReticulumPropagationStore.getState().startSync);
    render(<ReticulumPropagationSection embedded />);

    const syncBtn = screen.getByRole('button', {
      name: 'reticulumPropagation.syncNowPreferredAria',
    });
    expect(syncBtn).not.toBeDisabled();
    await user.click(syncBtn);

    await waitFor(() => {
      expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    });
    expect(setPreferredOnSidecar).not.toHaveBeenCalled();
  });

  it('Auto keeps Add & prefer and shows auto mode help', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      discovered: [
        {
          destination_hash: 'dead'.repeat(8),
          display_name: 'Seen',
          node_state: true,
          peering_cost: 0,
          hops: 1,
        },
      ],
    });
    render(<ReticulumPropagationSection embedded />);

    expect(
      screen.getByRole('button', { name: 'reticulumPropagation.discoveredAddPreferAria:Seen' }),
    ).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'auto');

    expect(screen.getByText('reticulumPropagation.modeHelpAuto')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'reticulumPropagation.discoveredAddPreferAria:Seen' }),
    ).toBeInTheDocument();
  });

  it('persists mode to localStorage on change', async () => {
    const user = userEvent.setup();
    render(<ReticulumPropagationSection embedded />);
    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    expect(localStorage.getItem(RETICULUM_PROPAGATION_MODE_KEY)).toBe('manual');
  });

  it('pushes the selected mode to the sidecar', async () => {
    const user = userEvent.setup();
    const setModeOnSidecar = vi.mocked(useReticulumPropagationStore.getState().setModeOnSidecar);
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    await waitFor(() => {
      expect(setModeOnSidecar).toHaveBeenCalledWith('manual');
    });

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'off');
    await waitFor(() => {
      expect(setModeOnSidecar).toHaveBeenCalledWith('off');
    });
  });

  it('Off disables per-node Sync as well as bottom Sync', () => {
    render(<ReticulumPropagationSection embedded />);

    expect(
      screen.getByRole('button', { name: 'reticulumPropagation.syncNowFor:Remote hub' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'reticulumPropagation.syncNowPreferredAria' }),
    ).toBeDisabled();
  });

  it('shows the local inbox as loading and blocks its Sync until the store is read', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'local-prop',
          name: 'Host propagation node',
          enabled: false,
          status: 'loading',
          hops: 0,
        },
      ],
    });
    render(<ReticulumPropagationSection embedded />);
    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');

    expect(screen.getByText(/reticulumPropagation\.nodeStatus\.loading/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'reticulumPropagation.syncNowFor:Host propagation node',
      }),
    ).toBeDisabled();
  });

  it('Manual without Preferred syncs the closest added remote', async () => {
    const user = userEvent.setup();
    const startSync = vi.mocked(useReticulumPropagationStore.getState().startSync);
    const setPreferredOnSidecar = vi.mocked(
      useReticulumPropagationStore.getState().setPreferredOnSidecar,
    );
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    const bottomSync = screen.getByRole('button', {
      name: 'reticulumPropagation.syncNowPreferredAria',
    });
    expect(bottomSync).not.toBeDisabled();
    await user.click(bottomSync);

    await waitFor(() => {
      expect(startSync).toHaveBeenCalledWith('pn-aabb1111');
    });
    expect(setPreferredOnSidecar).not.toHaveBeenCalled();
  });

  it('toggles the Chat propagation reminder and persists the choice', async () => {
    const user = userEvent.setup();
    render(<ReticulumPropagationSection embedded />);

    const checkbox = screen.getByLabelText<HTMLInputElement>(
      'reticulumPropagation.showChatNoticeAria',
    );
    expect(checkbox.checked).toBe(true);

    await user.click(checkbox);
    expect(useReticulumPropagationStore.getState().chatNoticeDismissed).toBe(true);
    expect(localStorage.getItem(RETICULUM_PROPAGATION_NOTICE_DISMISSED_KEY)).toBe('1');

    await user.click(checkbox);
    expect(useReticulumPropagationStore.getState().chatNoticeDismissed).toBe(false);
    expect(localStorage.getItem(RETICULUM_PROPAGATION_NOTICE_DISMISSED_KEY)).toBeNull();
  });

  it('names the node the cascade reached in the sync toast once it settles', async () => {
    const user = userEvent.setup();
    // Real startSync is mocked, so mirror the target stamp and the deferred settle it would write.
    useReticulumPropagationStore.setState({
      startSync: vi.fn().mockImplementation((id?: string) => {
        useReticulumPropagationStore.setState({
          syncTargetId: id ?? null,
          sync: { active: true, progress: 5, message: null },
          lastSyncError: null,
        });
        return Promise.resolve().then(() => {
          useReticulumPropagationStore.setState({
            sync: { active: false, progress: 0, message: null },
          });
          return 'accepted' as const;
        });
      }),
    });
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    await user.click(
      screen.getByRole('button', { name: 'reticulumPropagation.syncNowFor:Remote hub' }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'reticulumPropagation.syncLocalSettledFor:Remote hub',
        'success',
      );
    });
  });

  it('names the last node the cascade tried in the failure toast', async () => {
    const user = userEvent.setup();
    useReticulumPropagationStore.setState({
      nodes: [
        {
          id: 'pn-aabb1111',
          name: 'Remote hub',
          enabled: true,
          status: 'known',
          destination_hash: 'aabb1111222233334444555566667777',
        },
      ],
      startSync: vi.fn().mockImplementation((id?: string) => {
        useReticulumPropagationStore.setState({
          syncTargetId: id ?? null,
          lastSyncError: 'reticulumPropagation.syncFailed',
        });
        return Promise.resolve('failed' as const);
      }),
    });
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    await user.click(
      screen.getByRole('button', { name: 'reticulumPropagation.syncNowFor:Remote hub' }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'reticulumPropagation.syncErrorWithTarget:Remote hub',
        'error',
      );
    });
  });

  it('leaves the failure toast unprefixed when no node was contacted', async () => {
    const user = userEvent.setup();
    const startSync = vi.mocked(useReticulumPropagationStore.getState().startSync);
    useReticulumPropagationStore.setState({
      nodes: [
        { id: 'local-prop', name: 'Host propagation node', enabled: false, status: 'unknown' },
      ],
    });
    render(<ReticulumPropagationSection embedded />);

    await user.selectOptions(screen.getByLabelText('reticulumPropagation.modeAria'), 'manual');
    await user.click(
      screen.getByRole('button', {
        name: 'reticulumPropagation.syncNowFor:Host propagation node',
      }),
    );

    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('reticulumPropagation.syncNoTarget', 'error');
    });
    expect(startSync).not.toHaveBeenCalled();
  });
});
