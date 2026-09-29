import { Config } from '@meshtastic/protobufs';
import { describe, expect, it } from 'vitest';

import {
  meshtasticLoraConfigToProtobuf,
  shouldFetchLocalLoraConfigAfterConfigure,
} from './meshtasticLocalLoraConfig';

describe('shouldFetchLocalLoraConfigAfterConfigure', () => {
  const base = {
    skipLocalLoraConfig: false,
    configureTargetNodeNum: null as number | null,
    remoteAdminStatus: 'idle' as const,
    loraConfig: null as { region: number } | null,
  };

  it('returns true when no lora config is cached yet', () => {
    expect(shouldFetchLocalLoraConfigAfterConfigure(base)).toBe(true);
  });

  it('returns false when configure stream already hydrated lora config', () => {
    expect(shouldFetchLocalLoraConfigAfterConfigure({ ...base, loraConfig: { region: 1 } })).toBe(
      false,
    );
  });

  it('returns false during remote admin target or loading', () => {
    expect(
      shouldFetchLocalLoraConfigAfterConfigure({ ...base, configureTargetNodeNum: 0x123 }),
    ).toBe(false);
    expect(
      shouldFetchLocalLoraConfigAfterConfigure({ ...base, remoteAdminStatus: 'loading' }),
    ).toBe(false);
    expect(shouldFetchLocalLoraConfigAfterConfigure({ ...base, skipLocalLoraConfig: true })).toBe(
      false,
    );
  });
});

describe('meshtasticLoraConfigToProtobuf', () => {
  it('maps numeric region/preset onto the protobuf enums and keeps other fields', () => {
    const msg = meshtasticLoraConfigToProtobuf({
      region: Config.Config_LoRaConfig_RegionCode.US,
      modemPreset: Config.Config_LoRaConfig_ModemPreset.MEDIUM_FAST,
      usePreset: true,
      hopLimit: 5,
      txPower: 20,
    });
    expect(msg.$typeName).toBe('meshtastic.Config.LoRaConfig');
    expect(msg.region).toBe(Config.Config_LoRaConfig_RegionCode.US);
    expect(msg.modemPreset).toBe(Config.Config_LoRaConfig_ModemPreset.MEDIUM_FAST);
    expect(msg.usePreset).toBe(true);
    expect(msg.hopLimit).toBe(5);
    expect(msg.txPower).toBe(20);
  });

  it('leaves region/preset at proto defaults when omitted', () => {
    const msg = meshtasticLoraConfigToProtobuf({ hopLimit: 3 });
    expect(msg.region).toBe(Config.Config_LoRaConfig_RegionCode.UNSET);
    expect(msg.modemPreset).toBe(Config.Config_LoRaConfig_ModemPreset.LONG_FAST);
  });
});
