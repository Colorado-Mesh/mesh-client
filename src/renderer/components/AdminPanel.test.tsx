import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import AdminPanel from './AdminPanel';
import { ToastProvider } from './Toast';

const baseProps = {
  isConnected: true,
  onReboot: vi.fn().mockResolvedValue(undefined),
  onShutdown: vi.fn().mockResolvedValue(undefined),
  onFactoryReset: vi.fn().mockResolvedValue(undefined),
  onResetNodeDb: vi.fn().mockResolvedValue(undefined),
};

const fullCapabilities = {
  hasNodeDbReset: true,
  hasFactoryReset: true,
  hasShutdown: true,
} as Parameters<typeof AdminPanel>[0]['capabilities'];

describe('AdminPanel', () => {
  it('renders Device Commands section when connected', () => {
    render(
      <ToastProvider>
        <AdminPanel {...baseProps} capabilities={fullCapabilities} />
      </ToastProvider>,
    );

    const headings = [...document.querySelectorAll('h3')];
    expect(headings.find((h) => h.textContent?.trim() === 'Device Commands')).toBeDefined();
  });

  it('renders Danger Zone section when hasFactoryReset is true', () => {
    render(
      <ToastProvider>
        <AdminPanel {...baseProps} capabilities={fullCapabilities} />
      </ToastProvider>,
    );

    const headings = [...document.querySelectorAll('h3')];
    expect(headings.find((h) => h.textContent?.trim() === 'Danger Zone')).toBeDefined();
  });

  it('does not render Danger Zone when hasFactoryReset is false', () => {
    render(
      <ToastProvider>
        <AdminPanel
          {...baseProps}
          capabilities={
            { ...fullCapabilities, hasFactoryReset: false } as Parameters<
              typeof AdminPanel
            >[0]['capabilities']
          }
        />
      </ToastProvider>,
    );

    const headings = [...document.querySelectorAll('h3')];
    expect(headings.find((h) => h.textContent?.trim() === 'Danger Zone')).toBeUndefined();
  });

  it('shows connect banner when disconnected', () => {
    render(
      <ToastProvider>
        <AdminPanel {...baseProps} isConnected={false} />
      </ToastProvider>,
    );

    expect(screen.getByText('Connect to a device to modify configuration.')).toBeInTheDocument();
  });

  it('renders Reboot and Shutdown buttons when connected with capabilities', () => {
    render(
      <ToastProvider>
        <AdminPanel {...baseProps} capabilities={fullCapabilities} />
      </ToastProvider>,
    );

    expect(screen.getByRole('button', { name: /reboot$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /shutdown/i })).toBeInTheDocument();
  });
});
