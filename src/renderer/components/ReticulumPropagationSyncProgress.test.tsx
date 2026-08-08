import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReticulumPropagationStore } from '@/renderer/stores/reticulumPropagationStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts?.name ? `${key}[${opts.status ?? opts.message ?? ''}|${opts.name}]` : key,
  }),
}));

import { ReticulumPropagationSyncProgress } from './ReticulumPropagationSyncProgress';

function renderProgress() {
  return render(
    <ReticulumPropagationSyncProgress cancelLabel="cancel" cancelAriaLabel="cancel sync" />,
  );
}

describe('ReticulumPropagationSyncProgress', () => {
  beforeEach(() => {
    useReticulumPropagationStore.setState({
      nodes: [
        { id: 'local-prop', name: 'Local propagation node', enabled: true, status: 'known' },
        {
          id: 'pn-aabb1111',
          name: 'Remote hub',
          enabled: true,
          status: 'known',
          destination_hash: 'aabb'.repeat(8),
        },
      ],
      discovered: [],
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      syncTargetId: null,
    });
  });

  afterEach(() => {
    useReticulumPropagationStore.setState({
      sync: { active: false, progress: 0, message: null },
      lastSyncError: null,
      syncTargetId: null,
    });
  });

  it('names the node in the progress line while syncing', () => {
    useReticulumPropagationStore.setState({
      sync: { active: true, progress: 5, message: null },
      syncTargetId: 'pn-aabb1111',
    });
    renderProgress();
    expect(screen.getByRole('status')).toHaveTextContent(
      'reticulumPropagation.syncStatusWithTarget[reticulumPropagation.syncStatusEstablishing|Remote hub]',
    );
  });

  it('names a discovered node by its announce name', () => {
    useReticulumPropagationStore.setState({
      discovered: [
        {
          destination_hash: 'dead'.repeat(8),
          display_name: 'Discovered PN',
          node_state: true,
          peering_cost: 0,
          hops: 1,
        },
      ],
      sync: { active: true, progress: 60, message: null },
      syncTargetId: 'dead'.repeat(8),
    });
    renderProgress();
    expect(screen.getByRole('status')).toHaveTextContent(/Discovered PN/);
  });

  it('prefixes the error with the node that was tried', () => {
    useReticulumPropagationStore.setState({
      lastSyncError: 'reticulumPropagation.syncFailed',
      syncTargetId: 'pn-aabb1111',
    });
    renderProgress();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'reticulumPropagation.syncErrorWithTarget[reticulumPropagation.syncFailed|Remote hub]',
    );
  });

  it('leaves the error unprefixed when no node was contacted', () => {
    useReticulumPropagationStore.setState({
      lastSyncError: 'reticulumPropagation.syncNoTarget',
      syncTargetId: null,
    });
    renderProgress();
    expect(screen.getByRole('alert')).toHaveTextContent('reticulumPropagation.syncNoTarget');
  });
});
