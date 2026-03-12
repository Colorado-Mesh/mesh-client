import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import RadioPanel from './RadioPanel';
import { ToastProvider } from './Toast';

describe('RadioPanel accessibility', () => {
  const defaultProps = {
    onSetConfig: vi.fn().mockResolvedValue(undefined),
    onCommit: vi.fn().mockResolvedValue(undefined),
    onSetChannel: vi.fn().mockResolvedValue(undefined),
    onClearChannel: vi.fn().mockResolvedValue(undefined),
    channelConfigs: [] as {
      index: number;
      name: string;
      role: number;
      psk: Uint8Array;
      uplinkEnabled: boolean;
      downlinkEnabled: boolean;
      positionPrecision: number;
    }[],
    isConnected: false,
    onReboot: vi.fn().mockResolvedValue(undefined),
    onShutdown: vi.fn().mockResolvedValue(undefined),
    onFactoryReset: vi.fn().mockResolvedValue(undefined),
    onResetNodeDb: vi.fn().mockResolvedValue(undefined),
  };

  it('has no axe violations with empty channel configs', async () => {
    const { container } = render(
      <ToastProvider>
        <RadioPanel {...defaultProps} />
      </ToastProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
