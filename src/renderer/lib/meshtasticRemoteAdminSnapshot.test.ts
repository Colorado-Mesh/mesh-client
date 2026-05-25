import { Admin } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import type { MeshtasticRemoteAdminClient } from './meshtasticRemoteAdmin';
import {
  fetchMeshtasticRemoteConfigSnapshot,
  fetchMeshtasticRemoteConfigSnapshotDeferred,
  fetchMeshtasticRemoteConfigSnapshotEssential,
} from './meshtasticRemoteAdminSnapshot';

function clientWithChannelRetry<
  T extends { getRemoteChannel: MeshtasticRemoteAdminClient['getRemoteChannel'] },
>(client: T): T & Pick<MeshtasticRemoteAdminClient, 'getRemoteChannelWithRetry'> {
  return {
    ...client,
    getRemoteChannelWithRetry: (dest, index) => client.getRemoteChannel(dest, index),
  };
}

describe('fetchMeshtasticRemoteConfigSnapshot', () => {
  it('maps distinct config types into snapshot fields', async () => {
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfigWithRetry: vi.fn((_dest: number, type: number) => {
        if (type === Admin.AdminMessage_ConfigType.LORA_CONFIG) {
          return Promise.resolve({ payloadVariant: { case: 'lora', value: { region: 1 } } });
        }
        return Promise.reject(new Error('unexpected retry'));
      }),
      getRemoteConfig: vi.fn((_dest: number, type: number) => {
        if (type === Admin.AdminMessage_ConfigType.SECURITY_CONFIG) {
          return Promise.resolve({
            payloadVariant: {
              case: 'security',
              value: { publicKey: new Uint8Array(32), adminKey: [] },
            },
          });
        }
        return Promise.resolve({ payloadVariant: { case: 'device', value: {} } });
      }),
      getRemoteChannel: vi.fn((_dest: number, index: number) =>
        Promise.resolve({
          index,
          role: index === 0 ? 1 : 0,
          settings: { name: index === 0 ? 'Primary' : '', psk: new Uint8Array([1]) },
        }),
      ),
      getRemoteModuleConfig: vi.fn().mockRejectedValue(new Error('unsupported')),
      getRemoteOwner: vi.fn().mockResolvedValue({ longName: 'Remote', shortName: 'RM' }),
    } as unknown as MeshtasticRemoteAdminClient;

    const snapshot = await fetchMeshtasticRemoteConfigSnapshot(
      clientWithChannelRetry(client),
      0x200,
    );
    expect(snapshot.loraConfig).toEqual({ region: 1 });
    expect(snapshot.securityConfig?.publicKey).toHaveLength(32);
    expect(snapshot.securityConfig?.privateKey).toBeUndefined();
    expect(snapshot.channelConfigs?.[0]?.name).toBe('Primary');
    expect(snapshot.deviceOwner?.longName).toBe('Remote');
  });

  it('fetches config sections sequentially without overlapping calls', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];

    const track = (label: string) => {
      order.push(label);
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return () => {
        inFlight -= 1;
      };
    };

    const client = {
      getRemoteMetadata: vi.fn(async () => {
        const done = track('metadata');
        await Promise.resolve();
        done();
        return { firmwareVersion: '2.5.0' };
      }),
      ensureSessionKey: vi.fn(async () => {
        const done = track('ensureSessionKey');
        await Promise.resolve();
        done();
      }),
      getRemoteConfigWithRetry: vi.fn(async (_dest: number, type: number) => {
        const done = track(`configRetry:${type}`);
        await Promise.resolve();
        done();
        return { payloadVariant: { case: 'lora', value: { region: 1 } } };
      }),
      getRemoteConfig: vi.fn(async (_dest: number, type: number) => {
        const done = track(`config:${type}`);
        await Promise.resolve();
        done();
        return { payloadVariant: { case: 'device', value: {} } };
      }),
      getRemoteChannel: vi.fn(async (_dest: number, index: number) => {
        const done = track(`channel:${index}`);
        await Promise.resolve();
        done();
        return { index, role: 0, settings: { name: '', psk: new Uint8Array() } };
      }),
      getRemoteModuleConfig: vi.fn(async (_dest: number, type: number) => {
        const done = track(`module:${type}`);
        await Promise.resolve();
        done();
        return { payloadVariant: { case: 'mqtt', value: {} } };
      }),
      getRemoteOwner: vi.fn(async () => {
        const done = track('owner');
        await Promise.resolve();
        done();
        return { longName: 'Remote', shortName: 'RM' };
      }),
    } as unknown as MeshtasticRemoteAdminClient;

    await fetchMeshtasticRemoteConfigSnapshot(clientWithChannelRetry(client), 0x200);

    expect(maxInFlight).toBe(1);
    expect(order[0]).toBe('metadata');
    expect(order.at(-1)).toBe('owner');
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('ensureSessionKey'));
    expect(order.indexOf('ensureSessionKey')).toBeLessThan(
      order.findIndex((e) => e.startsWith('config:')),
    );
  });

  it('calls ensureSessionKey after metadata and before config fetches', async () => {
    const ensureSessionKey = vi.fn().mockResolvedValue(undefined);
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey,
      getRemoteConfigWithRetry: vi
        .fn()
        .mockResolvedValue({ payloadVariant: { case: 'lora', value: { region: 1 } } }),
      getRemoteConfig: vi.fn().mockResolvedValue({ payloadVariant: { case: 'device', value: {} } }),
      getRemoteChannel: vi.fn().mockResolvedValue({
        index: 0,
        role: 0,
        settings: { name: '', psk: new Uint8Array() },
      }),
      getRemoteModuleConfig: vi.fn().mockRejectedValue(new Error('unsupported')),
      getRemoteOwner: vi.fn().mockRejectedValue(new Error('unsupported')),
    } as unknown as MeshtasticRemoteAdminClient;

    await fetchMeshtasticRemoteConfigSnapshot(clientWithChannelRetry(client), 0x200);
    expect(ensureSessionKey).toHaveBeenCalledWith(0x200);
    const getRemoteConfig = vi.mocked(client.getRemoteConfig);
    expect(ensureSessionKey.mock.invocationCallOrder[0]).toBeLessThan(
      getRemoteConfig.mock.invocationCallOrder[0],
    );
  });

  it('continues snapshot when LoRa config fetch fails', async () => {
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfigWithRetry: vi.fn().mockRejectedValue(new Error('remoteAdmin.errors.timeout')),
      getRemoteConfig: vi.fn((_dest: number, type: number) => {
        if (type === Admin.AdminMessage_ConfigType.SECURITY_CONFIG) {
          return Promise.resolve({
            payloadVariant: {
              case: 'security',
              value: { publicKey: new Uint8Array(32), adminKey: [] },
            },
          });
        }
        return Promise.resolve({ payloadVariant: { case: 'device', value: {} } });
      }),
      getRemoteChannel: vi.fn((_dest: number, index: number) =>
        Promise.resolve({
          index,
          role: index === 0 ? 1 : 0,
          settings: { name: index === 0 ? 'Primary' : '', psk: new Uint8Array([1]) },
        }),
      ),
      getRemoteModuleConfig: vi.fn().mockRejectedValue(new Error('unsupported')),
      getRemoteOwner: vi.fn().mockRejectedValue(new Error('unsupported')),
    } as unknown as MeshtasticRemoteAdminClient;

    const snapshot = await fetchMeshtasticRemoteConfigSnapshot(
      clientWithChannelRetry(client),
      0x200,
    );
    expect(snapshot.loraConfig).toBeUndefined();
    expect(snapshot.loraConfigFetchFailed).toBe(true);
    expect(snapshot.loraConfigFetchError).toBe('remoteAdmin.errors.timeout');
    expect(snapshot.securityConfig?.publicKey).toHaveLength(32);
    expect(snapshot.channelConfigs?.[0]?.name).toBe('Primary');
  });

  it('continues snapshot when ensureSessionKey fails', async () => {
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockRejectedValue(new Error('remoteAdmin.errors.timeout')),
      getRemoteConfigWithRetry: vi
        .fn()
        .mockResolvedValue({ payloadVariant: { case: 'lora', value: { region: 1 } } }),
      getRemoteConfig: vi.fn().mockResolvedValue({ payloadVariant: { case: 'device', value: {} } }),
      getRemoteChannel: vi.fn().mockResolvedValue({
        index: 0,
        role: 1,
        settings: { name: 'Primary', psk: new Uint8Array([1]) },
      }),
      getRemoteModuleConfig: vi.fn().mockRejectedValue(new Error('unsupported')),
      getRemoteOwner: vi.fn().mockRejectedValue(new Error('unsupported')),
    } as unknown as MeshtasticRemoteAdminClient;

    const snapshot = await fetchMeshtasticRemoteConfigSnapshot(
      clientWithChannelRetry(client),
      0x200,
    );
    expect(snapshot.loraConfig).toEqual({ region: 1 });
    expect(snapshot.channelConfigs?.[0]?.name).toBe('Primary');
  });

  it('continues snapshot when a channel fetch fails', async () => {
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfigWithRetry: vi
        .fn()
        .mockResolvedValue({ payloadVariant: { case: 'lora', value: { region: 1 } } }),
      getRemoteConfig: vi.fn().mockResolvedValue({ payloadVariant: { case: 'device', value: {} } }),
      getRemoteChannel: vi.fn((_dest: number, index: number) => {
        if (index === 2) return Promise.reject(new Error('remoteAdmin.errors.timeout'));
        return Promise.resolve({
          index,
          role: index === 0 ? 1 : 0,
          settings: { name: index === 0 ? 'Primary' : '', psk: new Uint8Array([1]) },
        });
      }),
      getRemoteModuleConfig: vi.fn().mockRejectedValue(new Error('unsupported')),
      getRemoteOwner: vi.fn().mockRejectedValue(new Error('unsupported')),
    } as unknown as MeshtasticRemoteAdminClient;

    const snapshot = await fetchMeshtasticRemoteConfigSnapshot(
      clientWithChannelRetry(client),
      0x200,
    );
    expect(snapshot.channelConfigFetchFailed).toBe(true);
    expect(snapshot.primaryChannelConfigFetchFailed).toBe(false);
    expect(snapshot.failedChannelIndices).toEqual([2]);
    expect(snapshot.channelConfigs?.some((ch) => ch.index === 2)).toBe(false);
    expect(snapshot.channelConfigs?.[0]?.name).toBe('Primary');
  });

  it('marks primaryChannelConfigFetchFailed when channel 0 fails', async () => {
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfigWithRetry: vi
        .fn()
        .mockResolvedValue({ payloadVariant: { case: 'lora', value: { region: 1 } } }),
      getRemoteConfig: vi.fn().mockResolvedValue({ payloadVariant: { case: 'device', value: {} } }),
      getRemoteChannel: vi.fn((_dest: number, index: number) => {
        if (index === 0) return Promise.reject(new Error('remoteAdmin.errors.timeout'));
        return Promise.resolve({
          index,
          role: 0,
          settings: { name: '', psk: new Uint8Array() },
        });
      }),
      getRemoteModuleConfig: vi.fn().mockRejectedValue(new Error('unsupported')),
      getRemoteOwner: vi.fn().mockRejectedValue(new Error('unsupported')),
    } as unknown as MeshtasticRemoteAdminClient;

    const snapshot = await fetchMeshtasticRemoteConfigSnapshotEssential(
      clientWithChannelRetry(client),
      0x200,
    );
    expect(snapshot.primaryChannelConfigFetchFailed).toBe(true);
    expect(snapshot.failedChannelIndices).toContain(0);
  });
});

describe('fetchMeshtasticRemoteConfigSnapshotEssential', () => {
  it('does not fetch module configs or deferred-only core configs', async () => {
    const getRemoteModuleConfig = vi.fn();
    const getRemoteConfig = vi.fn((_dest: number, type: number) => {
      if (type === Admin.AdminMessage_ConfigType.SECURITY_CONFIG) {
        return Promise.resolve({
          payloadVariant: {
            case: 'security',
            value: { publicKey: new Uint8Array(32), adminKey: [] },
          },
        });
      }
      return Promise.resolve({ payloadVariant: { case: 'device', value: {} } });
    });
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfigWithRetry: vi
        .fn()
        .mockResolvedValue({ payloadVariant: { case: 'lora', value: { region: 1 } } }),
      getRemoteConfig,
      getRemoteChannel: vi.fn((_dest: number, index: number) =>
        Promise.resolve({
          index,
          role: index === 0 ? 1 : 0,
          settings: { name: index === 0 ? 'Primary' : '', psk: new Uint8Array([1]) },
        }),
      ),
      getRemoteModuleConfig,
      getRemoteOwner: vi.fn(),
    } as unknown as MeshtasticRemoteAdminClient;

    await fetchMeshtasticRemoteConfigSnapshotEssential(clientWithChannelRetry(client), 0x200);

    expect(getRemoteModuleConfig).not.toHaveBeenCalled();
    expect(getRemoteConfig).not.toHaveBeenCalledWith(
      0x200,
      Admin.AdminMessage_ConfigType.POSITION_CONFIG,
    );
  });

  it('fetches channel 0 before essential config types', async () => {
    const order: string[] = [];
    const client = {
      getRemoteMetadata: vi.fn(() => {
        order.push('metadata');
        return Promise.resolve({ firmwareVersion: '2.5.0' });
      }),
      ensureSessionKey: vi.fn(() => {
        order.push('ensureSessionKey');
        return Promise.resolve(undefined);
      }),
      getRemoteConfigWithRetry: vi.fn((_dest: number, type: number) => {
        order.push(`configRetry:${type}`);
        return Promise.resolve({ payloadVariant: { case: 'lora', value: { region: 1 } } });
      }),
      getRemoteConfig: vi.fn((_dest: number, type: number) => {
        order.push(`config:${type}`);
        return Promise.resolve({ payloadVariant: { case: 'device', value: {} } });
      }),
      getRemoteChannel: vi.fn((_dest: number, index: number) => {
        order.push(`channel:${index}`);
        return Promise.resolve({
          index,
          role: index === 0 ? 1 : 0,
          settings: { name: index === 0 ? 'Primary' : '', psk: new Uint8Array([1]) },
        });
      }),
    } as unknown as MeshtasticRemoteAdminClient;

    await fetchMeshtasticRemoteConfigSnapshotEssential(clientWithChannelRetry(client), 0x200);
    expect(order.indexOf('channel:0')).toBeGreaterThan(-1);
    expect(order.indexOf('channel:0')).toBeLessThan(
      order.findIndex((e) => e.startsWith('config:')),
    );
  });

  it('stops channel fetch after a trailing empty channel', async () => {
    const getRemoteChannel = vi.fn((_dest: number, index: number) => {
      if (index === 0) {
        return Promise.resolve({
          index: 0,
          role: 1,
          settings: { name: 'LongFast', psk: new Uint8Array([1]) },
        });
      }
      if (index === 1) {
        return Promise.resolve({
          index: 1,
          role: 0,
          settings: { name: '', psk: new Uint8Array() },
        });
      }
      return Promise.reject(new Error('should not fetch channel index ' + String(index)));
    });
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfigWithRetry: vi
        .fn()
        .mockResolvedValue({ payloadVariant: { case: 'lora', value: { region: 1 } } }),
      getRemoteConfig: vi.fn().mockResolvedValue({ payloadVariant: { case: 'device', value: {} } }),
      getRemoteChannel,
    } as unknown as MeshtasticRemoteAdminClient;

    const snapshot = await fetchMeshtasticRemoteConfigSnapshotEssential(
      clientWithChannelRetry(client),
      0x200,
    );
    expect(getRemoteChannel).toHaveBeenCalledTimes(2);
    expect(snapshot.channelConfigs).toHaveLength(1);
    expect(snapshot.channelConfigs?.[0]?.name).toBe('LongFast');
  });
});

describe('fetchMeshtasticRemoteConfigSnapshotDeferred', () => {
  it('fetches module configs without repeating essential fetches', async () => {
    const getRemoteMetadata = vi.fn();
    const getRemoteChannel = vi.fn();
    const getRemoteModuleConfig = vi.fn().mockResolvedValue({
      payloadVariant: { case: 'mqtt', value: { enabled: true } },
    });
    const client = {
      getRemoteMetadata,
      ensureSessionKey: vi.fn(),
      getRemoteConfig: vi.fn().mockResolvedValue({
        payloadVariant: { case: 'position', value: { fixedPosition: false } },
      }),
      getRemoteChannel,
      getRemoteModuleConfig,
      getRemoteOwner: vi.fn().mockResolvedValue({ longName: 'Remote', shortName: 'RM' }),
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigSnapshotDeferred(client, 0x200);
    expect(getRemoteMetadata).not.toHaveBeenCalled();
    expect(getRemoteChannel).not.toHaveBeenCalled();
    expect(getRemoteModuleConfig).toHaveBeenCalled();
    expect(partial.moduleConfigs?.mqtt).toEqual({ enabled: true });
    expect(partial.deviceOwner?.shortName).toBe('RM');
  });
});
