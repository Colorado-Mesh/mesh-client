import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import ConnectionPanel from './ConnectionPanel';
import type { DeviceState } from '../lib/types';

const disconnectedState: DeviceState = {
  status: 'disconnected',
  myNodeNum: 0,
  reconnectAttempt: 0,
  connectionType: null,
};

describe('ConnectionPanel accessibility', () => {
  it('has no axe violations in disconnected state', async () => {
    const { container } = render(
      <ConnectionPanel
        state={disconnectedState}
        onConnect={vi.fn().mockResolvedValue(undefined)}
        onAutoConnect={vi.fn().mockResolvedValue(undefined)}
        onDisconnect={vi.fn().mockResolvedValue(undefined)}
        mqttStatus="disconnected"
      />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
