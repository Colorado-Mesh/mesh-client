import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MeshcoreWaitingMessagesHeaderIndicator } from './MeshcoreWaitingMessagesHeaderIndicator';

describe('MeshcoreWaitingMessagesHeaderIndicator', () => {
  it('renders nothing when idle', () => {
    const { container } = render(
      <MeshcoreWaitingMessagesHeaderIndicator
        waitingMessagesCount={0}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive={false}
        waitingMessagesDrainDeferred={false}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows status with spinner during silent drain on serial', () => {
    render(
      <MeshcoreWaitingMessagesHeaderIndicator
        waitingMessagesCount={0}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive
        waitingMessagesDrainDeferred={false}
        connectionType="serial"
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Fetching messages queued on the radio/i),
    );
    expect(status).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/USB serial handles one command at a time/i),
    );
  });

  it('shows deferred status without spinner', () => {
    render(
      <MeshcoreWaitingMessagesHeaderIndicator
        waitingMessagesCount={1}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive={false}
        waitingMessagesDrainDeferred
      />,
    );
    const status = screen.getByRole('status');
    expect(status).not.toHaveAttribute('aria-busy');
    expect(status).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Message sync paused while the radio is busy/i),
    );
  });

  it('shows sync progress during manual sync', () => {
    render(
      <MeshcoreWaitingMessagesHeaderIndicator
        waitingMessagesCount={0}
        waitingMessagesSyncActive
        waitingMessagesSyncProgress={{ processed: 2, total: 5 }}
        waitingMessagesSilentDrainActive={false}
        waitingMessagesDrainDeferred={false}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      expect.stringMatching(/Syncing 2 \/ 5 from radio/i),
    );
  });

  it('clicking queued backlog triggers onSync', async () => {
    const user = userEvent.setup();
    const onSync = vi.fn();
    render(
      <MeshcoreWaitingMessagesHeaderIndicator
        waitingMessagesCount={3}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive={false}
        waitingMessagesDrainDeferred={false}
        onSync={onSync}
      />,
    );
    await user.click(
      screen.getByRole('button', {
        name: /3 queued message\(s\) on radio.*Sync now/i,
      }),
    );
    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('does not offer sync click while silent drain is active', () => {
    render(
      <MeshcoreWaitingMessagesHeaderIndicator
        waitingMessagesCount={3}
        waitingMessagesSyncActive={false}
        waitingMessagesSyncProgress={null}
        waitingMessagesSilentDrainActive
        waitingMessagesDrainDeferred={false}
        onSync={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
  });
});
