import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { MeshNode } from '../lib/types';
import { MeshcoreInfraConfigPanel } from './MeshcoreInfraConfigPanel';

const node: MeshNode = {
  node_id: 42,
  long_name: 'Test repeater',
  short_name: 'Test',
  hw_model: 'Repeater',
  snr: 0,
  battery: 0,
  last_heard: 0,
  latitude: null,
  longitude: null,
};
const initial: Record<string, string> = {
  'get name': '> Test repeater',
  'get owner.info': '> Operator',
  'get lat': '> 0',
  'get lon': '> 0',
  'get radio': '> 910.525,62.5,7,8',
  'get tx': '> 20',
  'get allow.read.only': '> off',
  'get guest.password': '> hello',
  'get acl': '',
};
function props(overrides = {}) {
  return {
    node,
    isConnected: true,
    onSend: vi.fn((command: string) => Promise.resolve(initial[command] ?? 'OK')),
    onBack: vi.fn(),
    onOpenCli: vi.fn(),
    ...overrides,
  };
}

describe('MeshCore infrastructure configuration panel', () => {
  it('reads and refreshes the repeater region tree, independently of default-scope support', async () => {
    const user = userEvent.setup();
    let tree = '*^ F\n us F\n  us-tn F\n   us-tn-tri\n';
    const send = vi.fn((command: string) =>
      Promise.resolve(command === 'region' ? tree : 'Unknown command: region default'),
    );
    const { container } = render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    expect(send).not.toHaveBeenCalled();
    await user.click(screen.getByText('Regions and flood scope'));
    const list = await screen.findByRole('list', { name: 'Configured regions' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getByText('us-tn-tri')).toBeInTheDocument();
    expect(within(list).getByText('Home')).toBeInTheDocument();
    expect(within(list).getByText('Flood denied')).toBeInTheDocument();
    expect(screen.getByLabelText('Region name (blank for unscoped)')).toBeDisabled();
    expect(send.mock.calls.map(([command]) => command)).toEqual(['region default', 'region']);
    tree = '*^ F\n eu F\n';
    await user.click(screen.getByRole('button', { name: 'Refresh Regions and flood scope' }));
    expect(await screen.findByText('eu')).toBeInTheDocument();
    expect(screen.queryByText('us-tn-tri')).not.toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('refreshes the region list after a default-scope write changes the repeater regions', async () => {
    const user = userEvent.setup();
    let scope = '<null>';
    const send = vi.fn((command: string) => {
      if (command === 'region')
        return Promise.resolve(scope === '<null>' ? '*^ F\n' : '*^ F\n new-region F\n');
      if (command.startsWith('region default ')) {
        scope = command.slice('region default '.length);
        return Promise.resolve(`default scope is now ${scope}`);
      }
      return Promise.resolve(`default scope is ${scope}`);
    });
    render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await user.click(screen.getByText('Regions and flood scope'));
    await screen.findByRole('list', { name: 'Configured regions' });
    await user.type(screen.getByLabelText('Region name (blank for unscoped)'), 'new-region');
    expect(screen.getByRole('button', { name: 'Refresh Regions and flood scope' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Apply Regions and flood scope' }));
    expect(await screen.findByText('new-region')).toBeInTheDocument();
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      'region default',
      'region',
      'region default new-region',
      'region default',
      'region',
    ]);
  });

  it('keeps default scope usable when listing fails and lets the user retry', async () => {
    const user = userEvent.setup();
    let fail = true;
    const send = vi.fn((command: string) => {
      if (command === 'region')
        return fail
          ? Promise.reject(new Error('CLI command timed out'))
          : Promise.resolve('* F\n us F\n');
      return Promise.resolve('default scope is <null>');
    });
    render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await user.click(screen.getByText('Regions and flood scope'));
    expect(await screen.findByRole('alert')).toHaveTextContent('CLI command timed out');
    expect(screen.getByLabelText('Region name (blank for unscoped)')).toBeEnabled();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Refresh Regions and flood scope' }));
    expect(await screen.findByText('us')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('warns about a truncated reply instead of displaying a partial final region', async () => {
    const user = userEvent.setup();
    const send = vi.fn((command: string) =>
      Promise.resolve(
        command === 'region'
          ? '* F\n' + ' region F\n'.repeat(15) + ' next'
          : 'default scope is <null>',
      ),
    );
    render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await user.click(screen.getByText('Regions and flood scope'));
    expect(await screen.findByText(/The firmware limited this reply/)).toBeInTheDocument();
    expect(screen.queryByText('next')).not.toBeInTheDocument();
  });

  it('rejects a late region reply after reconnect and supports an explicit refresh', async () => {
    const user = userEvent.setup();
    let resolve!: (value: string) => void;
    let pending = true;
    const send = vi.fn((command: string) => {
      if (command !== 'region') return Promise.resolve('default scope is <null>');
      return pending
        ? new Promise<string>((done) => {
            resolve = done;
          })
        : Promise.resolve('* F\n fresh F\n');
    });
    const { rerender } = render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await user.click(screen.getByText('Regions and flood scope'));
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
    rerender(<MeshcoreInfraConfigPanel {...props({ onSend: send, isConnected: false })} />);
    rerender(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await act(async () => {
      resolve('* F\n stale F\n');
      await Promise.resolve();
    });
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The operation stopped because the connection changed',
    );
    pending = false;
    await user.click(screen.getByRole('button', { name: 'Refresh Regions and flood scope' }));
    expect(await screen.findByText('fresh')).toBeInTheDocument();
  });

  it('reads, applies, and checks a room server default scope separately from access settings', async () => {
    const user = userEvent.setup();
    let scope = '<null>';
    const send = vi.fn((command: string) => {
      if (command.startsWith('region default ')) {
        scope = command.slice('region default '.length);
        return Promise.resolve(` default scope is now ${scope}`);
      }
      return Promise.resolve(` default scope is ${scope}`);
    });
    const { container } = render(
      <MeshcoreInfraConfigPanel
        {...props({ node: { ...node, hw_model: 'Room' }, onSend: send })}
      />,
    );
    await user.click(screen.getByText('Default flood scope'));
    const field = screen.getByLabelText('Region name (blank for unscoped)');
    await waitFor(() => {
      expect(field).toBeEnabled();
    });
    expect(field).toHaveValue('');
    await user.type(field, '#us-tn-tri');
    await user.click(screen.getByRole('button', { name: 'Apply Default flood scope' }));
    expect(await screen.findByText('Settings saved and checked.')).toBeInTheDocument();
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      'region default',
      'region default #us-tn-tri',
      'region default',
    ]);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps a default scope unavailable on firmware without region support', async () => {
    const user = userEvent.setup();
    render(
      <MeshcoreInfraConfigPanel
        {...props({ onSend: vi.fn().mockResolvedValue('Unknown command: region default') })}
      />,
    );
    await user.click(screen.getByText('Regions and flood scope'));
    expect(await screen.findByText('Unavailable on this firmware or board')).toBeInTheDocument();
    expect(screen.getByLabelText('Region name (blank for unscoped)')).toBeDisabled();
  });

  it('loads only the opened section and keeps unloaded settings disabled', async () => {
    const user = userEvent.setup();
    const p = props();
    render(<MeshcoreInfraConfigPanel {...p} />);
    expect(p.onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Frequency (MHz)')).toBeDisabled();
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeEnabled();
    });
    expect(p.onSend.mock.calls.map(([command]) => command)).toEqual([
      'get name',
      'get owner.info',
      'get lat',
      'get lon',
    ]);
    expect(screen.getByLabelText('Frequency (MHz)')).toBeDisabled();
  });

  it('loads a section opened while another section is still reading', async () => {
    const user = userEvent.setup();
    let resolve!: (value: string) => void;
    const send = vi.fn((command: string) =>
      command === 'get name'
        ? new Promise<string>((done) => {
            resolve = done;
          })
        : Promise.resolve(initial[command]),
    );
    render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    await user.click(screen.getByText('Radio parameters'));
    resolve('> Test repeater');
    await waitFor(() => {
      expect(screen.getByLabelText('Frequency (MHz)')).toBeEnabled();
    });
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      'get name',
      'get owner.info',
      'get lat',
      'get lon',
      'get radio',
      'get tx',
    ]);
  });

  it('saves edited values and verifies them before showing success', async () => {
    const user = userEvent.setup();
    let name = 'Test repeater';
    const p = props({
      onSend: vi.fn((command: string) => {
        if (command.startsWith('set name ')) {
          name = command.slice(9);
          return Promise.resolve('OK');
        }
        return Promise.resolve(command === 'get name' ? `> ${name}` : initial[command]);
      }),
    });
    render(<MeshcoreInfraConfigPanel {...p} />);
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeEnabled();
    });
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'New repeater');
    expect(screen.getByText('1 change')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh Identity and location' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Apply Identity and location' }));
    expect(await screen.findByText('Settings saved and checked.')).toBeInTheDocument();
    expect(name).toBe('New repeater');
    expect(screen.queryByText('1 change')).not.toBeInTheDocument();
    expect(screen.queryByText('Edited')).not.toBeInTheDocument();
    expect(screen.getByText('Settings read')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Identity and location' })).toBeDisabled();
  });

  it('retains edits and reports a rejected save', async () => {
    const user = userEvent.setup();
    render(
      <MeshcoreInfraConfigPanel
        {...props({
          onSend: vi.fn((command: string) =>
            Promise.resolve(command.startsWith('set ') ? 'Error: access denied' : initial[command]),
          ),
        })}
      />,
    );
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeEnabled();
    });
    await user.clear(screen.getByLabelText('Name'));
    await user.type(screen.getByLabelText('Name'), 'Retry name');
    await user.click(screen.getByRole('button', { name: 'Apply Identity and location' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The node rejected the command');
    expect(screen.getByLabelText('Name')).toHaveValue('Retry name');
    expect(screen.queryByText('Settings saved and checked.')).not.toBeInTheDocument();
  });

  it('keeps unsupported fields disabled while loading supported settings', async () => {
    const user = userEvent.setup();
    render(
      <MeshcoreInfraConfigPanel
        {...props({
          onSend: vi.fn((command: string) =>
            Promise.resolve(command === 'get owner.info' ? '??: owner.info' : initial[command]),
          ),
        })}
      />,
    );
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeEnabled();
    });
    expect(screen.getByLabelText('Owner information')).toBeDisabled();
    expect(screen.getByText('Unavailable on this firmware or board')).toBeInTheDocument();
  });

  it('stops loading when the panel closes', async () => {
    const user = userEvent.setup();
    let resolve!: (value: string) => void;
    const send = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const { unmount } = render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    unmount();
    resolve('> Test');
    await new Promise((done) => setTimeout(done, 0));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not revive an interrupted read after reconnect and allows a fresh retry', async () => {
    const user = userEvent.setup();
    let finishRead!: (value: string) => void;
    const pendingRead = new Promise<string>((resolve) => {
      finishRead = resolve;
    });
    let finishRadioRead!: (value: string) => void;
    const pendingRadioRead = new Promise<string>((resolve) => {
      finishRadioRead = resolve;
    });
    const send = vi
      .fn((command: string) =>
        command === 'get radio' ? pendingRadioRead : Promise.resolve(initial[command] ?? 'OK'),
      )
      .mockReturnValueOnce(pendingRead);
    const p = props({ onSend: send });
    const { rerender } = render(<MeshcoreInfraConfigPanel {...p} />);
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(1);
    });
    rerender(<MeshcoreInfraConfigPanel {...p} isConnected={false} />);
    rerender(<MeshcoreInfraConfigPanel {...p} isConnected />);
    expect(screen.getByRole('alert')).toHaveTextContent(/connection/);
    await act(async () => {
      finishRead('> Obsolete response');
      await pendingRead;
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Name')).toHaveValue('');
    expect(screen.getByRole('alert')).toHaveTextContent(/connection/);
    await user.click(screen.getByText('Radio parameters'));
    await waitFor(() => {
      expect(send).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/connection/);
    await act(async () => {
      finishRadioRead(initial['get radio']);
      await pendingRadioRead;
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Frequency (MHz)')).toBeEnabled();
    });
    await user.click(screen.getByRole('button', { name: 'Refresh Identity and location' }));
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toHaveValue('Test repeater');
    });
    expect(send).toHaveBeenCalledTimes(7);
  });

  it('keeps confirmed radio values and the reboot notice when a later write is interrupted', async () => {
    const user = userEvent.setup();
    let finishWrite!: (value: string) => void;
    const pendingWrite = new Promise<string>((resolve) => {
      finishWrite = resolve;
    });
    let radio = initial['get radio'];
    let tx = initial['get tx'];
    let firstTx = true;
    const send = vi.fn((command: string) => {
      if (command.startsWith('set radio ')) {
        const [frequency, ...parameters] = command.slice('set radio '.length).split(',');
        radio = `> ${[Math.fround(Number(frequency)), ...parameters].join(',')}`;
        return Promise.resolve('OK (reboot to apply)');
      }
      if (command === 'set tx 21') {
        tx = '> 21';
        if (firstTx) {
          firstTx = false;
          return pendingWrite;
        }
        return Promise.resolve('OK');
      }
      return Promise.resolve(command === 'get radio' ? radio : command === 'get tx' ? tx : 'OK');
    });
    const p = props({ onSend: send });
    const { rerender } = render(<MeshcoreInfraConfigPanel {...p} />);
    await user.click(screen.getByText('Radio parameters'));
    await waitFor(() => {
      expect(screen.getByLabelText('Frequency (MHz)')).toBeEnabled();
    });
    await user.clear(screen.getByLabelText('Frequency (MHz)'));
    await user.type(screen.getByLabelText('Frequency (MHz)'), '915.525');
    await user.clear(screen.getByLabelText('Transmit power (dBm)'));
    await user.type(screen.getByLabelText('Transmit power (dBm)'), '21');
    await user.click(screen.getByRole('button', { name: 'Apply Radio parameters' }));
    await waitFor(() => {
      expect(send).toHaveBeenCalledWith('set tx 21', expect.any(Function));
    });
    rerender(<MeshcoreInfraConfigPanel {...p} isConnected={false} />);
    rerender(<MeshcoreInfraConfigPanel {...p} isConnected />);
    await act(async () => {
      finishWrite('OK');
      await pendingWrite;
    });
    expect(screen.getByRole('alert')).toHaveTextContent(/edits are kept/);
    expect(screen.getByText(/Reboot this node through the CLI/)).toBeInTheDocument();
    expect(screen.getByLabelText('Frequency (MHz)')).toHaveValue(Math.fround(915.525));
    expect(screen.getByText('1 change')).toBeInTheDocument();
    expect(screen.getAllByText('Edited')).toHaveLength(1);
    expect(screen.getByLabelText('Transmit power (dBm)')).toHaveValue(21);
    await user.click(screen.getByRole('button', { name: 'Apply Radio parameters' }));
    expect(await screen.findByText('Settings saved and checked.')).toBeInTheDocument();
    expect(send.mock.calls.filter(([command]) => command.startsWith('set radio '))).toHaveLength(1);
    expect(send.mock.calls.filter(([command]) => command === 'set tx 21')).toHaveLength(2);
  });

  it('keeps a draft pending when firmware readback differs from the requested value', async () => {
    const user = userEvent.setup();
    let saved = false;
    const send = vi.fn((command: string) => {
      if (command.startsWith('set radio ')) {
        saved = true;
        return Promise.resolve('OK');
      }
      return Promise.resolve(
        command === 'get radio' && saved ? '> 900,62.5,7,8' : (initial[command] ?? 'OK'),
      );
    });
    render(<MeshcoreInfraConfigPanel {...props({ onSend: send })} />);
    await user.click(screen.getByText('Radio parameters'));
    await waitFor(() => {
      expect(screen.getByLabelText('Frequency (MHz)')).toBeEnabled();
    });
    await user.clear(screen.getByLabelText('Frequency (MHz)'));
    await user.type(screen.getByLabelText('Frequency (MHz)'), '915.525');
    await user.click(screen.getByRole('button', { name: 'Apply Radio parameters' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('different value after saving');
    expect(screen.getByLabelText('Frequency (MHz)')).toHaveValue(915.525);
    expect(screen.getByText('1 change')).toBeInTheDocument();
    expect(screen.getByText('Edited')).toBeInTheDocument();
  });

  it('shows room access and permission controls only for rooms', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<MeshcoreInfraConfigPanel {...props()} />);
    expect(screen.queryByText('Room access')).not.toBeInTheDocument();
    rerender(<MeshcoreInfraConfigPanel {...props({ node: { ...node, hw_model: 'Room' } })} />);
    await user.click(screen.getByText('Room access'));
    await waitFor(() => {
      expect(screen.getByLabelText('Guest password')).toBeEnabled();
    });
    expect(screen.getByLabelText('Guest password')).toHaveAttribute('type', 'password');
    expect(screen.getByText('Room permissions')).toBeInTheDocument();
  });

  it('keeps the ACL public key when a permission update fails', async () => {
    const user = userEvent.setup();
    render(
      <MeshcoreInfraConfigPanel
        {...props({
          node: { ...node, hw_model: 'Room' },
          onSend: vi.fn().mockResolvedValue('Error: denied'),
        })}
      />,
    );
    await user.click(screen.getByText('Room permissions'));
    const key = 'ab'.repeat(32);
    await user.type(screen.getByLabelText('Public key (64 hex)'), key);
    await user.click(screen.getByRole('button', { name: 'Apply ACL' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText('Public key (64 hex)')).toHaveValue(key);
  });

  it('reports an accepted permission update even when RF ACL listing is unsupported', async () => {
    const user = userEvent.setup();
    const send = vi.fn((command: string) =>
      Promise.resolve(command === 'get acl' ? '??: acl' : 'OK'),
    );
    render(
      <MeshcoreInfraConfigPanel
        {...props({ node: { ...node, hw_model: 'Room' }, onSend: send })}
      />,
    );
    await user.click(screen.getByText('Room permissions'));
    await user.type(screen.getByLabelText('Public key (64 hex)'), 'ab'.repeat(32));
    await user.click(screen.getByRole('button', { name: 'Apply ACL' }));
    expect(await screen.findByText(/Permission saved/)).toBeInTheDocument();
    expect(screen.getByLabelText('Public key (64 hex)')).toHaveValue('');
    expect(send).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Refresh ACL' }));
    expect(await screen.findByText(/ACL listing may be empty over the radio/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('opens Advanced CLI and keeps disconnected settings disabled', async () => {
    const user = userEvent.setup();
    const p = props({ isConnected: false });
    render(<MeshcoreInfraConfigPanel {...p} />);
    await user.click(screen.getByText('Identity and location'));
    expect(p.onSend).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Name')).toBeDisabled();
    await user.click(screen.getByText('Advanced'));
    await user.click(screen.getByRole('button', { name: 'CLI interface' }));
    expect(p.onOpenCli).toHaveBeenCalled();
  });

  it('has no accessibility violations with loaded settings', async () => {
    const user = userEvent.setup();
    const { container } = render(<MeshcoreInfraConfigPanel {...props()} />);
    await user.click(screen.getByText('Identity and location'));
    await waitFor(() => {
      expect(screen.getByLabelText('Name')).toBeEnabled();
    });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
