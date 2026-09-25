import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import type { TAKRemoteStatus } from '@/shared/tak-types';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import TakRemoteRelaySection from './TakRemoteRelaySection';

const tak = () => window.electronAPI.tak;

async function renderSection() {
  const result = render(<TakRemoteRelaySection />);
  await act(async () => {});
  return result;
}

describe('TakRemoteRelaySection', () => {
  beforeEach(() => {
    vi.mocked(tak().remoteGetStatus).mockResolvedValue({
      state: 'disconnected',
      host: '',
      port: 8089,
    });
    vi.mocked(tak().remoteGetSettings).mockResolvedValue(null);
    vi.mocked(tak().remoteGetCredentials).mockResolvedValue({ caSubjects: [] });
    vi.mocked(tak().onRemoteStatus).mockReturnValue(() => {});
    vi.mocked(tak().remoteStart).mockClear();
    vi.mocked(tak().remoteStop).mockClear();
    vi.mocked(tak().remoteImportCredentials).mockReset().mockResolvedValue(null);
  });

  it('starts empty with the default port and verification on', async () => {
    await renderSection();
    expect(screen.getByLabelText('Server address')).toHaveValue('');
    expect(screen.getByLabelText('Port')).toHaveValue(8089);
    expect(screen.getByLabelText(/verify the server certificate/i)).toBeChecked();
    expect(screen.getByText('Not connected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('fills the form from saved settings', async () => {
    vi.mocked(tak().remoteGetSettings).mockResolvedValue({
      host: 'tak.example.org',
      port: 8443,
      verifyServer: false,
      autoConnect: true,
    });
    await renderSection();
    expect(screen.getByLabelText('Server address')).toHaveValue('tak.example.org');
    expect(screen.getByLabelText('Port')).toHaveValue(8443);
    expect(screen.getByLabelText(/verify the server certificate/i)).not.toBeChecked();
    expect(screen.getByLabelText(/connect on application launch/i)).toBeChecked();
  });

  it('connects with the entered settings', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.type(screen.getByLabelText('Server address'), ' 192.168.1.20 ');
    await user.click(screen.getByLabelText(/connect on application launch/i));
    await user.click(screen.getByRole('button', { name: 'Connect' }));
    expect(tak().remoteStart).toHaveBeenCalledWith({
      host: '192.168.1.20',
      port: 8089,
      verifyServer: true,
      autoConnect: true,
    });
  });

  it('warns when server verification is turned off', async () => {
    const user = userEvent.setup();
    await renderSection();
    expect(screen.queryByText(/without verification/i)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/verify the server certificate/i));
    expect(screen.getByText(/without verification/i)).toBeInTheDocument();
  });

  it('shows inline errors for an invalid host and port', async () => {
    const user = userEvent.setup();
    await renderSection();
    await user.type(screen.getByLabelText('Server address'), 'ssl://tak');
    const port = screen.getByLabelText('Port');
    await user.clear(port);
    await user.type(port, '70000');
    expect(screen.getByText('Enter a hostname or IP address')).toBeInTheDocument();
    expect(screen.getByText('Port must be between 1 and 65535')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
  });

  it('shows the live status and last error, and disconnects', async () => {
    let push: ((s: TAKRemoteStatus) => void) | undefined;
    vi.mocked(tak().onRemoteStatus).mockImplementation((cb) => {
      push = cb;
      return () => {};
    });
    const user = userEvent.setup();
    await renderSection();

    act(() => {
      push?.({ state: 'connecting', host: 'tak.example.org', port: 8089, error: 'ECONNREFUSED' });
    });
    expect(screen.getByText('Connecting to tak.example.org:8089…')).toBeInTheDocument();
    expect(screen.getByText('Last error: ECONNREFUSED')).toBeInTheDocument();
    expect(screen.getByLabelText('Server address')).toBeDisabled();

    act(() => {
      push?.({ state: 'connected', host: 'tak.example.org', port: 8089, connectedAt: 1 });
    });
    expect(screen.getByText('Connected to tak.example.org:8089')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(tak().remoteStop).toHaveBeenCalled();
  });

  it('imports certificates with the password, then clears the password field', async () => {
    vi.mocked(tak().remoteImportCredentials).mockResolvedValue({
      caSubjects: ['Colorado TAK CA'],
      clientSubject: 'kd0abc',
      clientExpiresAt: Date.UTC(2027, 5, 1),
    });
    const user = userEvent.setup();
    await renderSection();
    expect(screen.getByText(/no ca imported/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText('Certificate password'), 'atakatak');
    await user.click(screen.getByRole('button', { name: 'Import Certificates' }));

    expect(tak().remoteImportCredentials).toHaveBeenCalledWith('atakatak');
    expect(screen.getByText('Trusted CA: Colorado TAK CA')).toBeInTheDocument();
    expect(screen.getByText(/client certificate: kd0abc/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Certificate password')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Remove Certificates' })).toBeInTheDocument();
  });

  it('shows an import error without the Electron IPC prefix', async () => {
    vi.mocked(tak().remoteImportCredentials).mockRejectedValue(
      new Error(
        "Error invoking remote method 'tak:remoteImportCredentials': Error: user.p12: Wrong password for the PKCS#12 file",
      ),
    );
    const user = userEvent.setup();
    await renderSection();
    await user.click(screen.getByRole('button', { name: 'Import Certificates' }));
    expect(screen.getByText('user.p12: Wrong password for the PKCS#12 file')).toBeInTheDocument();
  });

  it('has no axe accessibility violations', async () => {
    vi.mocked(tak().remoteGetCredentials).mockResolvedValue({
      caSubjects: ['Colorado TAK CA'],
      clientSubject: 'kd0abc',
      clientExpiresAt: Date.UTC(2027, 5, 1),
    });
    vi.mocked(tak().remoteGetStatus).mockResolvedValue({
      state: 'connecting',
      host: 'tak.example.org',
      port: 8089,
      error: 'certificate required',
    });
    const { container } = await renderSection();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
