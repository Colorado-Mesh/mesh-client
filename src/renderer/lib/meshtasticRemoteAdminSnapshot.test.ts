import { Admin } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import type { MeshtasticRemoteAdminClient } from './meshtasticRemoteAdmin';
import { fetchMeshtasticRemoteConfigSnapshot } from './meshtasticRemoteAdminSnapshot';

describe('fetchMeshtasticRemoteConfigSnapshot', () => {
  it('maps distinct config types into snapshot fields', async () => {
    const client = {
      getRemoteMetadata: vi.fn().mockResolvedValue({ firmwareVersion: '2.5.0' }),
      getRemoteConfig: vi.fn((_dest: number, type: number) => {
        if (type === Admin.AdminMessage_ConfigType.LORA_CONFIG) {
          return Promise.resolve({ payloadVariant: { case: 'lora', value: { region: 1 } } });
        }
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

    const snapshot = await fetchMeshtasticRemoteConfigSnapshot(client, 0x200);
    expect(snapshot.loraConfig).toEqual({ region: 1 });
    expect(snapshot.securityConfig?.publicKey).toHaveLength(32);
    expect(snapshot.securityConfig?.privateKey).toBeUndefined();
    expect(snapshot.channelConfigs?.[0]?.name).toBe('Primary');
    expect(snapshot.deviceOwner?.longName).toBe('Remote');
  });
});
