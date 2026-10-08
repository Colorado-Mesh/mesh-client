// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { LORA_BLOCKLIST_SCOPE_ID } from '@/renderer/lib/loraBlocklist';
import type { MeshNode } from '@/renderer/lib/types';
import { useBlockStore } from '@/renderer/stores/blockStore';

import { LoraBlockedNodesSection } from './LoraBlockedNodesSection';

function seed(hashes: string[]): void {
  useBlockStore.setState({
    byProtocol: {
      meshtastic: {
        identityId: LORA_BLOCKLIST_SCOPE_ID,
        hashes: new Set(hashes),
        entries: hashes.map((hash) => ({ hash, createdAt: Date.UTC(2026, 0, 15) })),
        loaded: true,
      },
    },
  });
}

describe('LoraBlockedNodesSection', () => {
  beforeEach(() => {
    useBlockStore.setState({ byProtocol: {} });
    vi.mocked(window.electronAPI.db.unblockContact).mockClear();
  });

  it('shows the empty state', () => {
    render(<LoraBlockedNodesSection protocol="meshtastic" />);
    expect(screen.getByText('No blocked nodes.')).toBeInTheDocument();
  });

  it('labels known nodes by name and unblocks under the LoRa scope', async () => {
    const user = userEvent.setup();
    seed(['77']);
    const nodes = new Map<number, MeshNode>([
      [77, { node_id: 77, long_name: 'Noisy Node', short_name: 'NOIS' } as MeshNode],
    ]);
    render(<LoraBlockedNodesSection protocol="meshtastic" nodes={nodes} />);
    await user.click(screen.getByRole('button', { name: 'Unblock Noisy Node' }));
    await waitFor(() => {
      expect(window.electronAPI.db.unblockContact).toHaveBeenCalledWith(
        'meshtastic',
        LORA_BLOCKLIST_SCOPE_ID,
        '77',
      );
    });
    expect(useBlockStore.getState().isBlocked('77', 'meshtastic')).toBe(false);
  });

  it('has no axe violations with entries', async () => {
    seed(['77', 'ab'.repeat(32)]);
    const { container } = render(<LoraBlockedNodesSection protocol="meshtastic" />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
