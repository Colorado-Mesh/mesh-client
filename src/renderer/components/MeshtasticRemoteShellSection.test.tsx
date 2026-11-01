import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { emptyRemoteShellFrame, type RemoteShellFrame } from '../lib/meshtastic/remoteShell';
import {
  handleRemoteShellFrame,
  resetRemoteShellSessionForTests,
  setRemoteShellSender,
} from '../lib/meshtastic/remoteShellSession';
import { MESHCORE_CAPABILITIES, MESHTASTIC_CAPABILITIES } from '../lib/radio/BaseRadioProvider';
import { useRemoteShellStore } from '../stores/remoteShellStore';
import MeshtasticRemoteShellSection, {
  parseRemoteShellNodeInput,
} from './MeshtasticRemoteShellSection';

vi.mock('../lib/identityByProtocol', () => ({ getIdentityIdForProtocol: () => 'mt-1' }));

const sent: RemoteShellFrame[] = [];

function remote(op: RemoteShellFrame['op'], patch: Partial<RemoteShellFrame> = {}) {
  const s = useRemoteShellStore.getState();
  act(() => {
    handleRemoteShellFrame('mt-1', s.nodeNum ?? 0, {
      ...emptyRemoteShellFrame(op, s.sessionId),
      ...patch,
    });
  });
}

describe('parseRemoteShellNodeInput', () => {
  it.each([
    ['!a1b2c3d4', 0xa1b2c3d4],
    ['0xFF', 255],
    ['123456', 123456],
    ['  !00000001 ', 1],
  ])('parses %s', (input, expected) => {
    expect(parseRemoteShellNodeInput(input)).toBe(expected);
  });
  it.each(['', 'abc', '!xyz', '0', '!0', '99999999999', '!123456789'])('rejects %j', (input) => {
    expect(parseRemoteShellNodeInput(input)).toBeNull();
  });
});

describe('MeshtasticRemoteShellSection', () => {
  beforeEach(() => {
    sent.length = 0;
    setRemoteShellSender((_i, _d, frame) => {
      sent.push(frame);
      return Promise.resolve();
    });
  });
  afterEach(() => {
    resetRemoteShellSessionForTests();
    vi.restoreAllMocks();
  });

  it('renders nothing for protocols without remote shell', () => {
    const { container } = render(
      <MeshtasticRemoteShellSection capabilities={MESHCORE_CAPABILITIES} isConnected />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('always shows the security warning and gates Open on acknowledgement', async () => {
    const user = userEvent.setup();
    render(
      <MeshtasticRemoteShellSection
        capabilities={MESHTASTIC_CAPABILITIES}
        isConnected
        targetNodeNum={0x1234}
      />,
    );
    expect(screen.getByTestId('remote-shell-warning')).toHaveTextContent(/Security warning/);
    const open = screen.getByRole('button', { name: 'Open shell' });
    expect(open).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    expect(open).toBeEnabled();
    expect(screen.getByRole('textbox', { name: 'Target node' })).toHaveValue('!00001234');
  });

  it('requires a connected radio and a valid node', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MeshtasticRemoteShellSection capabilities={MESHTASTIC_CAPABILITIES} isConnected={false} />,
    );
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByRole('textbox', { name: 'Target node' }), '!1234');
    expect(screen.getByRole('button', { name: 'Open shell' })).toBeDisabled();
    rerender(<MeshtasticRemoteShellSection capabilities={MESHTASTIC_CAPABILITIES} isConnected />);
    expect(screen.getByRole('button', { name: 'Open shell' })).toBeEnabled();
  });

  it('runs a session: open, output, send command, close', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MeshtasticRemoteShellSection capabilities={MESHTASTIC_CAPABILITIES} isConnected />,
    );
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByRole('textbox', { name: 'Target node' }), '!1234');
    await user.click(screen.getByRole('button', { name: 'Open shell' }));
    expect(screen.getByTestId('remote-shell-status')).toHaveTextContent(
      /Opening a shell on !00001234/,
    );
    expect(sent[0]?.op).toBe('open');

    remote('openOk');
    expect(screen.getByTestId('remote-shell-status')).toHaveTextContent(/Shell open/);
    remote('output', { seq: 1, payload: new TextEncoder().encode('root@node:~# ') });
    expect(screen.getByRole('log', { name: 'Remote shell output' })).toHaveTextContent(
      'root@node:~#',
    );

    await user.type(screen.getByRole('textbox', { name: 'Remote shell command' }), 'uptime');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    const input = sent.find((f) => f.op === 'input');
    expect(new TextDecoder().decode(input?.payload)).toBe('uptime\n');

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Close shell' }));
    expect(sent.at(-1)?.op).toBe('close');
    expect(screen.getByTestId('remote-shell-status')).toHaveTextContent('Shell closed.');
  });

  it('surfaces open timeout and lost-frame warnings', () => {
    render(<MeshtasticRemoteShellSection capabilities={MESHTASTIC_CAPABILITIES} isConnected />);
    act(() => {
      useRemoteShellStore.setState({ phase: 'error', errorCode: 'open_timeout', gapCount: 3 });
    });
    expect(screen.getByTestId('remote-shell-error')).toHaveTextContent(/did not answer in time/);
    expect(screen.getByTestId('remote-shell-gaps')).toHaveTextContent('3 output frames were lost');
  });

  it('closes a live session when the section unmounts', async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <MeshtasticRemoteShellSection capabilities={MESHTASTIC_CAPABILITIES} isConnected />,
    );
    await user.click(screen.getByRole('checkbox'));
    await user.type(screen.getByRole('textbox', { name: 'Target node' }), '!1234');
    await user.click(screen.getByRole('button', { name: 'Open shell' }));
    remote('openOk');
    unmount();
    expect(sent.at(-1)?.op).toBe('close');
    expect(useRemoteShellStore.getState().phase).toBe('closed');
  });
});
