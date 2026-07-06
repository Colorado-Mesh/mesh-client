import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MeshcoreWaitingMessagesBanner } from './MeshcoreWaitingMessagesBanner';

describe('MeshcoreWaitingMessagesBanner', () => {
  it('shows queued count when idle with backlog', () => {
    render(
      <MeshcoreWaitingMessagesBanner
        waitingMessagesCount={3}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive={false}
        waitingMessagesDrainDeferred={false}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('3 queued message(s) on radio');
  });

  it('shows deferred status text', () => {
    render(
      <MeshcoreWaitingMessagesBanner
        waitingMessagesCount={1}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive={false}
        waitingMessagesDrainDeferred
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Message sync paused');
  });

  it('shows sync progress during manual sync', () => {
    render(
      <MeshcoreWaitingMessagesBanner
        waitingMessagesCount={0}
        waitingMessagesSyncActive
        waitingMessagesSyncProgress={{ processed: 2, total: 5 }}
        waitingMessagesSilentDrainActive={false}
        waitingMessagesDrainDeferred={false}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Syncing 2 / 5 from radio');
  });

  it('disables Sync now during silent drain', () => {
    render(
      <MeshcoreWaitingMessagesBanner
        waitingMessagesCount={1}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive
        waitingMessagesDrainDeferred={false}
        onSyncWaitingMessages={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeDisabled();
  });

  it('shows serial hint during silent drain on serial transport', () => {
    render(
      <MeshcoreWaitingMessagesBanner
        waitingMessagesCount={0}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive
        waitingMessagesDrainDeferred={false}
        connectionType="serial"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('USB serial handles one command');
  });
});
