// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createLinuxBluezClient } from './client';

type MethodFn = (...args: unknown[]) => Promise<unknown>;

function variant(value: unknown): { value: unknown } {
  return { value };
}

function makeBus(opts: {
  objects: Record<string, Record<string, Record<string, { value: unknown }>>>;
  pair?: MethodFn;
  removeDevice?: MethodFn;
  setTrusted?: MethodFn;
  startDiscovery?: MethodFn;
  stopDiscovery?: MethodFn;
  connect?: MethodFn;
  registerAgent?: MethodFn;
  unregisterAgent?: MethodFn;
  requestDefaultAgent?: MethodFn;
}) {
  const exported: { path: string; iface: unknown }[] = [];
  const propsSet = vi.fn(() => Promise.resolve(undefined));
  const pair = opts.pair ?? vi.fn(() => Promise.resolve(undefined));
  const removeDevice = opts.removeDevice ?? vi.fn(() => Promise.resolve(undefined));
  const startDiscovery = opts.startDiscovery ?? vi.fn(() => Promise.resolve(undefined));
  const stopDiscovery = opts.stopDiscovery ?? vi.fn(() => Promise.resolve(undefined));
  const connect = opts.connect ?? vi.fn(() => Promise.resolve(undefined));
  const registerAgent = opts.registerAgent ?? vi.fn(() => Promise.resolve(undefined));
  const unregisterAgent = opts.unregisterAgent ?? vi.fn(() => Promise.resolve(undefined));
  const requestDefaultAgent = opts.requestDefaultAgent ?? vi.fn(() => Promise.resolve(undefined));

  const bus = {
    disconnect: vi.fn(),
    export: vi.fn((path: string, iface: unknown) => {
      exported.push({ path, iface });
    }),
    unexport: vi.fn(),
    getProxyObject: vi.fn((_name: string, path: string) => {
      if (path === '/') {
        return Promise.resolve({
          getInterface: (iface: string) => {
            if (iface === 'org.freedesktop.DBus.ObjectManager') {
              return {
                GetManagedObjects: () => Promise.resolve(opts.objects),
              };
            }
            throw new Error(`unexpected interface ${iface} on /`);
          },
        });
      }
      if (path === '/org/bluez') {
        return Promise.resolve({
          getInterface: (iface: string) => {
            if (iface === 'org.bluez.AgentManager1') {
              return {
                RegisterAgent: registerAgent,
                UnregisterAgent: unregisterAgent,
                RequestDefaultAgent: requestDefaultAgent,
              };
            }
            throw new Error(`unexpected interface ${iface} on /org/bluez`);
          },
        });
      }
      return Promise.resolve({
        getInterface: (iface: string) => {
          if (iface === 'org.freedesktop.DBus.Properties') {
            return { Set: propsSet };
          }
          if (iface === 'org.bluez.Device1') {
            return { Pair: pair, Connect: connect };
          }
          if (iface === 'org.bluez.Adapter1') {
            return {
              StartDiscovery: startDiscovery,
              StopDiscovery: stopDiscovery,
              RemoveDevice: removeDevice,
            };
          }
          throw new Error(`unexpected interface ${iface} on ${path}`);
        },
      });
    }),
  };

  return {
    bus,
    exported,
    propsSet,
    pair,
    removeDevice,
    startDiscovery,
    stopDiscovery,
    connect,
    registerAgent,
    unregisterAgent,
    requestDefaultAgent,
  };
}

describe('createLinuxBluezClient', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const adapterPath = '/org/bluez/hci0';
  const devicePath = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';
  const mac = 'AA:BB:CC:DD:EE:FF';

  function pairedObjects(paired: boolean) {
    return {
      [adapterPath]: {
        'org.bluez.Adapter1': { Address: variant('00:11:22:33:44:55') },
      },
      [devicePath]: {
        'org.bluez.Device1': {
          Address: variant(mac),
          Name: variant('MeshCore Radio'),
          Alias: variant('MeshCore Radio'),
          Paired: variant(paired),
          Trusted: variant(paired),
          Connected: variant(false),
        },
      },
    };
  }

  it('formats getDeviceInfoText with Paired yes/no', async () => {
    const { bus } = makeBus({ objects: pairedObjects(true) });
    const client = createLinuxBluezClient(() => bus as never);
    const info = await client.getDeviceInfoText(mac);
    expect(info).toContain('Paired: yes');
    expect(info).toContain('Trusted: yes');
    expect(info).toContain('MeshCore Radio');
  });

  it('reports unpaired when device is missing', async () => {
    const { bus } = makeBus({
      objects: {
        [adapterPath]: {
          'org.bluez.Adapter1': { Address: variant('00:11:22:33:44:55') },
        },
      },
    });
    const client = createLinuxBluezClient(() => bus as never);
    const info = await client.getDeviceInfoText(mac);
    expect(info).toContain('Paired: no');
  });

  it('registers agent, pairs, trusts, then unregisters', async () => {
    const { bus, pair, registerAgent, requestDefaultAgent, unregisterAgent, propsSet, exported } =
      makeBus({ objects: pairedObjects(false) });
    const client = createLinuxBluezClient(() => bus as never);
    await client.pairWithPin(mac, '123456');
    expect(exported).toHaveLength(1);
    expect(registerAgent).toHaveBeenCalled();
    expect(requestDefaultAgent).toHaveBeenCalled();
    expect(pair).toHaveBeenCalled();
    expect(propsSet).toHaveBeenCalledWith(
      'org.bluez.Device1',
      'Trusted',
      expect.objectContaining({ value: true }),
    );
    expect(unregisterAgent).toHaveBeenCalled();
  });

  it('removes a device via Adapter1.RemoveDevice', async () => {
    const { bus, removeDevice } = makeBus({ objects: pairedObjects(true) });
    const client = createLinuxBluezClient(() => bus as never);
    await client.removeDevice(mac);
    expect(removeDevice).toHaveBeenCalledWith(devicePath);
  });

  it('starts and stops discovery on the primary adapter', async () => {
    const { bus, startDiscovery, stopDiscovery } = makeBus({ objects: pairedObjects(false) });
    const client = createLinuxBluezClient(() => bus as never);
    await client.startDiscovery();
    await client.stopDiscovery();
    expect(startDiscovery).toHaveBeenCalled();
    expect(stopDiscovery).toHaveBeenCalled();
  });

  it('connects an existing device', async () => {
    const { bus, connect } = makeBus({ objects: pairedObjects(true) });
    const client = createLinuxBluezClient(() => bus as never);
    await client.connectDevice(mac);
    expect(connect).toHaveBeenCalled();
  });

  it('maps bus factory failures to BlueZ unavailable', async () => {
    const client = createLinuxBluezClient(() => {
      throw new Error('connect ENOENT');
    });
    await expect(client.getDeviceInfoText(mac)).rejects.toThrow(/BlueZ D-Bus unavailable/);
  });
});
