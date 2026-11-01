import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '@/renderer/lib/radio/BaseRadioProvider';

import AdminPanel from './AdminPanel';
import { ToastProvider } from './Toast';

vi.mock('@/renderer/lib/identityByProtocol', () => ({ getIdentityIdForProtocol: () => 'mt-1' }));

const baseProps = {
  isConnected: true,
  onReboot: vi.fn().mockResolvedValue(undefined),
  onShutdown: vi.fn().mockResolvedValue(undefined),
  onFactoryReset: vi.fn().mockResolvedValue(undefined),
  onResetNodeDb: vi.fn().mockResolvedValue(undefined),
};

describe('AdminPanel remote shell (protocol exception: Meshtastic only)', () => {
  it('shows the remote shell section for Meshtastic', () => {
    render(
      <ToastProvider>
        <AdminPanel {...baseProps} capabilities={MESHTASTIC_CAPABILITIES} />
      </ToastProvider>,
    );
    expect(screen.getByTestId('admin-remote-shell')).toBeInTheDocument();
  });

  it('prefills the remote-config target node', () => {
    render(
      <ToastProvider>
        <AdminPanel
          {...baseProps}
          capabilities={MESHTASTIC_CAPABILITIES}
          configTarget={{ mode: 'remote', nodeNum: 0xabc, isReady: true, isLoading: false }}
        />
      </ToastProvider>,
    );
    expect(screen.getByRole('textbox', { name: 'Target node' })).toHaveValue('!00000abc');
  });

  it.each([
    ['meshcore', MESHCORE_CAPABILITIES],
    ['reticulum', RETICULUM_CAPABILITIES],
  ] as const)('hides it for %s', (_name, capabilities) => {
    render(
      <ToastProvider>
        <AdminPanel {...baseProps} capabilities={capabilities} />
      </ToastProvider>,
    );
    expect(screen.queryByTestId('admin-remote-shell')).not.toBeInTheDocument();
  });
});
