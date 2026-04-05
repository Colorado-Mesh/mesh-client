import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import TakServerPanel from './TakServerPanel';

describe('TakServerPanel', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.tak.getStatus).mockResolvedValue({
      running: false,
      port: 8089,
      clientCount: 0,
    });
    vi.mocked(window.electronAPI.tak.getConnectedClients).mockResolvedValue([]);
    vi.mocked(window.electronAPI.tak.onStatus).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.tak.onClientConnected).mockReturnValue(() => {});
    vi.mocked(window.electronAPI.tak.onClientDisconnected).mockReturnValue(() => {});
  });

  it('renders stopped status initially', async () => {
    render(<TakServerPanel />);
    await act(async () => {});
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('shows Start Server button when stopped', async () => {
    render(<TakServerPanel />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: /start server/i })).toBeInTheDocument();
  });

  it('shows Stop Server button when running', async () => {
    vi.mocked(window.electronAPI.tak.getStatus).mockResolvedValue({
      running: true,
      port: 8089,
      clientCount: 0,
    });
    render(<TakServerPanel />);
    await act(async () => {});
    expect(screen.getByRole('button', { name: /stop server/i })).toBeInTheDocument();
  });

  it('calls tak.start with current settings on Start click', async () => {
    const user = userEvent.setup();
    render(<TakServerPanel />);
    await act(async () => {});
    await user.click(screen.getByRole('button', { name: /start server/i }));
    expect(window.electronAPI.tak.start).toHaveBeenCalledWith({
      enabled: true,
      port: 8089,
      serverName: 'mesh-client',
      requireClientCert: true,
      autoStart: false,
    });
  });

  it('calls tak.stop on Stop click', async () => {
    vi.mocked(window.electronAPI.tak.getStatus).mockResolvedValue({
      running: true,
      port: 8089,
      clientCount: 0,
    });
    const user = userEvent.setup();
    render(<TakServerPanel />);
    await act(async () => {});
    await user.click(screen.getByRole('button', { name: /stop server/i }));
    expect(window.electronAPI.tak.stop).toHaveBeenCalled();
  });

  it('disables Start button when port is invalid', async () => {
    const user = userEvent.setup();
    render(<TakServerPanel />);
    await act(async () => {});
    const portInput = screen.getByRole('spinbutton');
    await user.clear(portInput);
    await user.type(portInput, '80');
    expect(screen.getByRole('button', { name: /start server/i })).toBeDisabled();
  });

  it('shows port validation error for out-of-range port', async () => {
    const user = userEvent.setup();
    render(<TakServerPanel />);
    await act(async () => {});
    const portInput = screen.getByRole('spinbutton');
    await user.clear(portInput);
    await user.type(portInput, '80');
    expect(screen.getByText(/port must be 1024/i)).toBeInTheDocument();
  });

  it('calls generateDataPackage when Generate button is clicked (server running)', async () => {
    vi.mocked(window.electronAPI.tak.getStatus).mockResolvedValue({
      running: true,
      port: 8089,
      clientCount: 0,
    });
    const user = userEvent.setup();
    render(<TakServerPanel />);
    await act(async () => {});
    await user.click(screen.getByRole('button', { name: /generate & reveal/i }));
    expect(window.electronAPI.tak.generateDataPackage).toHaveBeenCalled();
  });

  it('calls regenerateCertificates on Regenerate Certificates click', async () => {
    const user = userEvent.setup();
    render(<TakServerPanel />);
    await act(async () => {});
    await user.click(screen.getByRole('button', { name: /regenerate certificates/i }));
    expect(window.electronAPI.tak.regenerateCertificates).toHaveBeenCalled();
  });

  it('shows client count in status bar when running', async () => {
    vi.mocked(window.electronAPI.tak.getStatus).mockResolvedValue({
      running: true,
      port: 8089,
      clientCount: 2,
    });
    render(<TakServerPanel />);
    await act(async () => {});
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText(/2 clients/i)).toBeInTheDocument();
  });

  it('shows connected clients list when running', async () => {
    vi.mocked(window.electronAPI.tak.getStatus).mockResolvedValue({
      running: true,
      port: 8089,
      clientCount: 1,
    });
    vi.mocked(window.electronAPI.tak.getConnectedClients).mockResolvedValue([
      { id: 'a', address: '10.0.0.1', callsign: 'ALPHA', connectedAt: Date.now() - 5000 },
    ]);
    render(<TakServerPanel />);
    await act(async () => {});
    expect(screen.getByText('ALPHA')).toBeInTheDocument();
  });

  it('has no axe accessibility violations', async () => {
    const { container } = render(<TakServerPanel />);
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
