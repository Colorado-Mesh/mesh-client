import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

describe('ChatPanel accessibility', () => {
  const defaultProps = {
    messages: [],
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 0,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onNodeClick: vi.fn(),
    isConnected: false,
    nodes: new Map(),
    isActive: true,
  };

  it('has no axe violations with empty messages', async () => {
    const { container } = render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
