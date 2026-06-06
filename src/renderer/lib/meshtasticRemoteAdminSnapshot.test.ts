import { Admin } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import type { MeshtasticRemoteAdminClient, RemoteAdminSendOptions } from './meshtasticRemoteAdmin';
import {
  REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS,
  REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS,
  REMOTE_ADMIN_ESSENTIAL_MAX_ATTEMPTS,
  REMOTE_ADMIN_ESSENTIAL_RESPONSE_TIMEOUT_MS,
  REMOTE_ADMIN_LORA_CONFIG_RETRY_BACKOFF_MS,
  REMOTE_ADMIN_READ_SEND_OPTIONS,
} from './meshtasticRemoteAdmin';
import {
  fetchMeshtasticRemoteConfigChannelsTail,
  fetchMeshtasticRemoteConfigModules,
  fetchMeshtasticRemoteConfigOwner,
  fetchMeshtasticRemoteConfigSecurity,
  fetchMeshtasticRemoteConfigSnapshot,
  fetchMeshtasticRemoteConfigSnapshotDeferred,
  fetchMeshtasticRemoteConfigSnapshotEssential,
  fetchMeshtasticRemoteConfigSnapshotRadio,
  mergeMeshtasticRemoteConfigSnapshots,
  remoteConfigChannelRetryRoute,
} from './meshtasticRemoteAdminSnapshot';
import type { MeshtasticRemoteConfigSnapshot } from './types';

type MeshtasticAdminConfigType =
  (typeof Admin.AdminMessage_ConfigType)[keyof typeof Admin.AdminMessage_ConfigType];

function clientWithChannelRetry<
  T extends { getRemoteChannel: MeshtasticRemoteAdminClient['getRemoteChannel'] },
>(client: T): T & Pick<MeshtasticRemoteAdminClient, 'getRemoteChannelWithRetry'> {
  return {
    ...client,
    getRemoteChannelWithRetry: (dest, index, options) =>
      client.getRemoteChannel(dest, index, options?.sendOptions),
  };
}

describe('remoteConfigChannelRetryRoute', () => {
  it('returns radio when primary channel failed', () => {
    expect(
      remoteConfigChannelRetryRoute({
        failedChannelIndices: [0],
        primaryChannelConfigFetchFailed: true,
      }),
    ).toBe('radio');
    expect(remoteConfigChannelRetryRoute({ failedChannelIndices: [0] })).toBe('radio');
    expect(remoteConfigChannelRetryRoute({ primaryChannelConfigFetchFailed: true })).toBe('radio');
  });

  it('returns channelsTail when only secondary channels failed', () => {
    expect(remoteConfigChannelRetryRoute({ failedChannelIndices: [2, 3] })).toBe('channelsTail');
    expect(remoteConfigChannelRetryRoute({})).toBe('channelsTail');
  });
});

describe('fetchMeshtasticRemoteConfigSnapshot', () => {
  it('maps distinct config types into snapshot fields', async () => {
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfigWithRetry: vi.fn((_dest: number, type: MeshtasticAdminConfigType) => {
        if (type === Admin.AdminMessage_ConfigType.LORA_CONFIG) {
          return Promise.resolve({ payloadVariant: { case: 'lora', value: { region: 1 } } });
        }
        return Promise.reject(new Error('unexpected retry'));
      }),
      getRemoteConfig: vi.fn((_dest: number, type: MeshtasticAdminConfigType) => {
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
      getRemoteConfigWithRetry: vi.fn(async (_dest: number, type: MeshtasticAdminConfigType) => {
        const done = track(`configRetry:${type}`);
        await Promise.resolve();
        done();
        return { payloadVariant: { case: 'lora', value: { region: 1 } } };
      }),
      getRemoteConfig: vi.fn(async (_dest: number, type: MeshtasticAdminConfigType) => {
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
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('channel:0'));
    expect(order.indexOf('metadata')).toBeLessThan(
      order.findIndex((e) => e.startsWith('configRetry:')),
    );
  });

  it('calls ensureSessionKey before channels tail and deferred security fetch', async () => {
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
      getRemoteOwner: vi.fn().mockResolvedValue({ longName: 'Remote', shortName: 'RM' }),
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
      getRemoteConfig: vi.fn((_dest: number, type: MeshtasticAdminConfigType) => {
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
    expect(snapshot.loraConfig).toBeUndefined();
    expect(snapshot.loraConfigFetchFailed).toBe(true);
    expect(snapshot.loraConfigFetchError).toBe('remoteAdmin.errors.timeout');
    expect(snapshot.securityConfig?.publicKey).toHaveLength(32);
    expect(snapshot.channelConfigs?.[0]?.name).toBe('Primary');
  });

  it('propagates when ensureSessionKey fails before channels tail', async () => {
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
      getRemoteOwner: vi.fn().mockResolvedValue({ longName: 'Remote', shortName: 'RM' }),
    } as unknown as MeshtasticRemoteAdminClient;

    await expect(
      fetchMeshtasticRemoteConfigSnapshot(clientWithChannelRetry(client), 0x200),
    ).rejects.toThrow('remoteAdmin.errors.timeout');
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
      getRemoteOwner: vi.fn().mockResolvedValue({ longName: 'Remote', shortName: 'RM' }),
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
  it('fetches only channel 0 and LoRa for the initial Channels route', async () => {
    const getRemoteModuleConfig = vi.fn();
    const getRemoteConfig = vi.fn((_dest: number, type: MeshtasticAdminConfigType) => {
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
    expect(client.getRemoteMetadata).not.toHaveBeenCalled();
    expect(client.ensureSessionKey).not.toHaveBeenCalled();
    expect(getRemoteConfig).not.toHaveBeenCalled();
    expect(client.getRemoteConfigWithRetry).toHaveBeenCalledWith(
      0x200,
      Admin.AdminMessage_ConfigType.LORA_CONFIG,
      expect.any(Object),
    );
    expect(client.getRemoteChannel).toHaveBeenCalledTimes(1);
    expect(client.getRemoteChannel).toHaveBeenCalledWith(0x200, 0, REMOTE_ADMIN_READ_SEND_OPTIONS);
    expect(getRemoteConfig).not.toHaveBeenCalledWith(
      0x200,
      Admin.AdminMessage_ConfigType.POSITION_CONFIG,
    );
  });

  it('uses tail-channel retry options for primary channel and essential options for LoRa', async () => {
    const getRemoteChannelWithRetry = vi.fn(
      (
        _dest: number,
        index: number,
        options?: {
          maxAttempts?: number;
          backoffMs?: number;
          sendOptions?: RemoteAdminSendOptions;
        },
      ) => {
        if (index !== 0) {
          return Promise.reject(new Error('unexpected channel index'));
        }
        expect(options?.maxAttempts).toBe(REMOTE_ADMIN_CHANNEL_MAX_ATTEMPTS);
        expect(options?.backoffMs).toBe(REMOTE_ADMIN_CHANNEL_RETRY_BACKOFF_MS);
        expect(options?.sendOptions).toEqual(REMOTE_ADMIN_READ_SEND_OPTIONS);
        return Promise.resolve({
          index: 0,
          role: 1,
          settings: { name: 'Primary', psk: new Uint8Array([1]) },
        });
      },
    );
    const getRemoteConfigWithRetry = vi.fn(
      (
        _dest: number,
        type: MeshtasticAdminConfigType,
        options?: {
          maxAttempts?: number;
          backoffMs?: number;
          sendOptions?: RemoteAdminSendOptions;
        },
      ) => {
        expect(type).toBe(Admin.AdminMessage_ConfigType.LORA_CONFIG);
        expect(options?.maxAttempts).toBe(REMOTE_ADMIN_ESSENTIAL_MAX_ATTEMPTS);
        expect(options?.backoffMs).toBe(REMOTE_ADMIN_LORA_CONFIG_RETRY_BACKOFF_MS);
        expect(options?.sendOptions?.timeoutMs).toBe(REMOTE_ADMIN_ESSENTIAL_RESPONSE_TIMEOUT_MS);
        return Promise.resolve({ payloadVariant: { case: 'lora', value: { region: 1 } } });
      },
    );
    const client = {
      getRemoteMetadata: vi.fn(),
      ensureSessionKey: vi.fn(),
      getRemoteConfigWithRetry,
      getRemoteConfig: vi.fn(),
      getRemoteChannel: vi.fn(),
      getRemoteChannelWithRetry,
    } as unknown as MeshtasticRemoteAdminClient;

    await fetchMeshtasticRemoteConfigSnapshotEssential(client, 0x200);

    expect(getRemoteChannelWithRetry).toHaveBeenCalledWith(0x200, 0, expect.any(Object));
    expect(getRemoteConfigWithRetry).toHaveBeenCalledWith(
      0x200,
      Admin.AdminMessage_ConfigType.LORA_CONFIG,
      expect.any(Object),
    );
  });

  it('fetchMeshtasticRemoteConfigSnapshotRadio bootstraps session before channel 0', async () => {
    const order: string[] = [];
    const client = {
      getRemoteMetadata: vi.fn(() => {
        order.push('metadata');
        return Promise.resolve({ firmwareVersion: '2.5.0' });
      }),
      ensureSessionKey: vi.fn(() => {
        order.push('ensureSessionKey');
        return Promise.resolve();
      }),
      getRemoteConfigWithRetry: vi
        .fn()
        .mockResolvedValue({ payloadVariant: { case: 'lora', value: { region: 1 } } }),
      getRemoteChannel: vi.fn((_dest: number, index: number) => {
        order.push(`channel:${index}`);
        return Promise.resolve({
          index,
          role: index === 0 ? 1 : 0,
          settings: { name: 'Primary', psk: new Uint8Array([1]) },
        });
      }),
    } as unknown as MeshtasticRemoteAdminClient;

    await fetchMeshtasticRemoteConfigSnapshotRadio(clientWithChannelRetry(client), 0x200);

    expect(order.indexOf('metadata')).toBeGreaterThan(-1);
    expect(order.indexOf('channel:0')).toBeGreaterThan(-1);
    expect(order.indexOf('metadata')).toBeLessThan(order.indexOf('channel:0'));
    expect(client.getRemoteMetadata).toHaveBeenCalledTimes(1);
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
      getRemoteConfigWithRetry: vi.fn((_dest: number, type: MeshtasticAdminConfigType) => {
        order.push(`configRetry:${type}`);
        return Promise.resolve({ payloadVariant: { case: 'lora', value: { region: 1 } } });
      }),
      getRemoteConfig: vi.fn((_dest: number, type: MeshtasticAdminConfigType) => {
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
    expect(order.indexOf('ensureSessionKey')).toBe(-1);
    expect(order.indexOf('channel:0')).toBeGreaterThan(-1);
    expect(order.indexOf('channel:0')).toBeLessThan(
      order.findIndex((e) => e.startsWith('configRetry:')),
    );
  });

  it('does not fetch trailing channels during initial essential fetch', async () => {
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
    expect(getRemoteChannel).toHaveBeenCalledTimes(1);
    expect(snapshot.channelConfigs).toHaveLength(1);
    expect(snapshot.channelConfigs?.[0]?.name).toBe('LongFast');
  });

  it('chains trailing channel fetches separately and stops after an empty channel', async () => {
    const getRemoteChannel = vi.fn((_dest: number, index: number) => {
      if (index === 1) {
        return Promise.resolve({
          index: 1,
          role: 1,
          settings: { name: 'Secondary', psk: new Uint8Array([2]) },
        });
      }
      if (index === 2) {
        return Promise.resolve({
          index: 2,
          role: 0,
          settings: { name: '', psk: new Uint8Array() },
        });
      }
      return Promise.reject(new Error('should not fetch channel index ' + String(index)));
    });
    const client = {
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteChannel,
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigChannelsTail(
      clientWithChannelRetry(client),
      0x200,
    );
    expect(client.ensureSessionKey).toHaveBeenCalledWith(0x200);
    expect(getRemoteChannel).toHaveBeenCalledTimes(3);
    expect(getRemoteChannel).toHaveBeenNthCalledWith(1, 0x200, 1, undefined);
    expect(getRemoteChannel).toHaveBeenNthCalledWith(2, 0x200, 2, undefined);
    expect(getRemoteChannel).toHaveBeenNthCalledWith(3, 0x200, 2, undefined);
    expect(partial.channelConfigs).toHaveLength(1);
    expect(partial.channelConfigs?.[0]?.name).toBe('Secondary');
  });

  it('retries a transient empty secondary channel before stopping the tail loop', async () => {
    let channelOneCalls = 0;
    const getRemoteChannel = vi.fn((_dest: number, index: number) => {
      if (index === 1) {
        channelOneCalls += 1;
        if (channelOneCalls === 1) {
          return Promise.resolve({
            index: 1,
            role: 0,
            settings: { name: '', psk: new Uint8Array() },
          });
        }
        return Promise.resolve({
          index: 1,
          role: 2,
          settings: { name: 'Secondary', psk: new Uint8Array([2]) },
        });
      }
      if (index >= 2) {
        return Promise.resolve({
          index,
          role: 0,
          settings: { name: '', psk: new Uint8Array() },
        });
      }
      return Promise.reject(new Error('should not fetch channel index ' + String(index)));
    });
    const client = {
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteChannel,
      getRemoteChannelWithRetry: (dest: number, idx: number) => getRemoteChannel(dest, idx),
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigChannelsTail(client, 0x200);
    expect(getRemoteChannel).toHaveBeenCalledTimes(4);
    expect(partial.channelConfigs).toHaveLength(1);
    expect(partial.channelConfigs?.[0]?.name).toBe('Secondary');
  });
});

describe('mergeMeshtasticRemoteConfigSnapshots', () => {
  it('merges module configs and keeps essential channel configs when deferred omits them', () => {
    const essential: MeshtasticRemoteConfigSnapshot = {
      metadata: { firmwareVersion: '2.5.0' },
      moduleConfigs: { mqtt: { enabled: false } },
      channelConfigs: [
        {
          index: 0,
          name: 'LongFast',
          role: 1,
          psk: new Uint8Array([1]),
          uplinkEnabled: true,
          downlinkEnabled: true,
          positionPrecision: 0,
        },
      ],
    };
    const deferred = {
      moduleConfigs: { serial: { enabled: true } },
      deviceOwner: { longName: 'Remote', shortName: 'RM', isLicensed: false },
    };
    const merged = mergeMeshtasticRemoteConfigSnapshots(essential, deferred);
    expect(merged.moduleConfigs).toEqual({
      mqtt: { enabled: false },
      serial: { enabled: true },
    });
    expect(merged.channelConfigs).toEqual(essential.channelConfigs);
    expect(merged.deviceOwner?.shortName).toBe('RM');
  });
});

describe('fetchMeshtasticRemoteConfigSnapshotDeferred', () => {
  it('continues deferred core snapshot when a core config fetch fails', async () => {
    const getRemoteConfig = vi.fn((_dest: number, type: MeshtasticAdminConfigType) => {
      if (type === Admin.AdminMessage_ConfigType.POSITION_CONFIG) {
        return Promise.reject(new Error('remoteAdmin.errors.timeout'));
      }
      return Promise.resolve({
        payloadVariant: { case: 'power', value: { isPowerSaving: false } },
      });
    });
    const client = {
      getRemoteConfig,
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigSnapshotDeferred(client, 0x200);
    expect(getRemoteConfig).toHaveBeenCalled();
    expect(partial.moduleConfigs).toBeUndefined();
    expect(partial.deviceOwner).toBeUndefined();
  });

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
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigModules(client, 0x200);
    expect(getRemoteMetadata).not.toHaveBeenCalled();
    expect(getRemoteChannel).not.toHaveBeenCalled();
    expect(getRemoteModuleConfig).toHaveBeenCalled();
    expect(partial.moduleConfigs?.mqtt).toEqual({ enabled: true });
  });

  it('emits partial module configs as each module returns', async () => {
    const getRemoteModuleConfig = vi
      .fn()
      .mockResolvedValueOnce({
        payloadVariant: { case: 'mqtt', value: { enabled: true } },
      })
      .mockResolvedValueOnce({
        payloadVariant: { case: 'serial', value: { enabled: false } },
      })
      .mockResolvedValue({
        payloadVariant: { case: 'telemetry', value: { deviceUpdateInterval: 900 } },
      });
    const client = {
      getRemoteModuleConfig,
    } as unknown as MeshtasticRemoteAdminClient;
    const partialSnapshots: Partial<MeshtasticRemoteConfigSnapshot>[] = [];

    const partial = await fetchMeshtasticRemoteConfigModules(client, 0x200, {
      onPartial: (chunk) => {
        partialSnapshots.push(chunk);
      },
    });

    expect(partialSnapshots.length).toBeGreaterThan(0);
    expect(partialSnapshots[0]?.moduleConfigs?.mqtt).toEqual({ enabled: true });
    expect(partial.moduleConfigs?.mqtt).toEqual({ enabled: true });
  });

  it('fetches owner separately from module and core config routes', async () => {
    const client = {
      getRemoteOwner: vi.fn().mockResolvedValue({ longName: 'Remote', shortName: 'RM' }),
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigOwner(client, 0x200);
    expect(client.getRemoteOwner).toHaveBeenCalledWith(0x200);
    expect(partial.deviceOwner?.shortName).toBe('RM');
  });

  it('fetches security separately from the initial Channels route', async () => {
    const client = {
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfig: vi.fn().mockResolvedValue({
        payloadVariant: {
          case: 'security',
          value: { publicKey: new Uint8Array(32), adminKey: [] },
        },
      }),
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigSecurity(client, 0x200);
    expect(client.ensureSessionKey).toHaveBeenCalledWith(0x200);
    expect(client.getRemoteConfig).toHaveBeenCalledWith(
      0x200,
      Admin.AdminMessage_ConfigType.SECURITY_CONFIG,
    );
    expect(partial.securityConfig?.publicKey).toHaveLength(32);
  });

  it('strips privateKey from remote security config snapshot', async () => {
    const client = {
      ensureSessionKey: vi.fn().mockResolvedValue(undefined),
      getRemoteConfig: vi.fn().mockResolvedValue({
        payloadVariant: {
          case: 'security',
          value: {
            publicKey: new Uint8Array(32),
            privateKey: new Uint8Array(32).fill(7),
            adminKey: [],
          },
        },
      }),
    } as unknown as MeshtasticRemoteAdminClient;

    const partial = await fetchMeshtasticRemoteConfigSecurity(client, 0x200);
    expect(partial.securityConfig?.privateKey).toBeUndefined();
    expect(partial.securityConfig?.publicKey).toHaveLength(32);
  });
});
