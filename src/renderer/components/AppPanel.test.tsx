import { act, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import AppPanel from './AppPanel';
import { ToastProvider } from './Toast';

describe('AppPanel accessibility', () => {
  const defaultProps = {
    protocol: 'meshtastic' as const,
    nodes: new Map(),
    messageCount: 0,
    channels: [] as { index: number; name: string }[],
    myNodeNum: null as number | null,
    onLocationFilterChange: vi.fn(),
  };

  it('has no axe violations with empty state', async () => {
    const { container } = render(
      <ToastProvider>
        <AppPanel {...defaultProps} />
      </ToastProvider>,
    );
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
