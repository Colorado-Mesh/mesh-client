import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { GlobalMessageSearchDialog } from './GlobalMessageSearchDialog';

describe('GlobalMessageSearchDialog', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.db.searchMessages).mockResolvedValue([
      {
        id: 1,
        sender_id: 10,
        sender_name: 'Alpha',
        payload: 'hello mesh search',
        channel: 0,
        timestamp: 1_700_000_000_000,
        packetId: null,
        status: 'acked',
        error: null,
        emoji: null,
        replyId: null,
        to: undefined,
        mqttStatus: null,
        receivedVia: null,
      },
    ]);
    vi.mocked(window.electronAPI.db.searchMeshcoreMessages).mockResolvedValue([]);
    vi.mocked(window.electronAPI.db.searchReticulumMessages).mockResolvedValue([]);
  });

  it('searches and selects a hit', async () => {
    const user = userEvent.setup();
    const onSelectHit = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <GlobalMessageSearchDialog
        open
        onClose={onClose}
        enabledProtocols={['meshtastic', 'meshcore', 'reticulum']}
        reticulumIdentityId="id-1"
        onSelectHit={onSelectHit}
      />,
    );
    hydrateAxeThemeColors(container);

    const input = screen.getByLabelText('Search messages across protocols…');
    await user.type(input, 'hello');

    await waitFor(() => {
      expect(window.electronAPI.db.searchMessages).toHaveBeenCalled();
    });
    expect(await screen.findByText('hello mesh search')).toBeInTheDocument();

    await user.click(screen.getByText('hello mesh search'));
    expect(onSelectHit).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'meshtastic',
        payload: 'hello mesh search',
        channel: 0,
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });
});
