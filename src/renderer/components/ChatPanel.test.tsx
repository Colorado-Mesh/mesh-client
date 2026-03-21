import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import ChatPanel from './ChatPanel';
import { ToastProvider } from './Toast';

describe('ChatPanel accessibility', () => {
  const defaultProps = {
    messages: [],
    channels: [{ index: 0, name: 'General' }],
    myNodeNum: 0,
    onSend: vi.fn().mockResolvedValue(undefined),
    onReact: vi.fn().mockResolvedValue(undefined),
    onResend: vi.fn(),
    onNodeClick: vi.fn(),
    isConnected: false,
    nodes: new Map(),
    isActive: true,
  };

  it('has no axe violations with empty messages', async () => {
    const { container } = render(
      <ToastProvider>
        <ChatPanel {...defaultProps} />
      </ToastProvider>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('shows RF transport badge for incoming messages with receivedVia rf', () => {
    render(
      <ToastProvider>
        <ChatPanel
          {...defaultProps}
          myNodeNum={1}
          messages={[
            {
              sender_id: 2,
              sender_name: 'Other',
              payload: 'Hello',
              channel: 0,
              timestamp: Date.now(),
              status: 'acked',
              receivedVia: 'rf',
            },
          ]}
        />
      </ToastProvider>,
    );
    expect(screen.getByTitle('Received via RF')).toBeInTheDocument();
  });
});
