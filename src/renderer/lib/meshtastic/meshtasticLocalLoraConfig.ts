import { create } from '@bufbuild/protobuf';
import { Config } from '@meshtastic/protobufs';

import type { MeshtasticLoraConfig } from '@/shared/meshtasticUrlEncoder';

import type { RemoteAdminStatus } from '../types';

/** Whether to issue a deferred local `getConfig(LORA)` after DeviceConfigured. */
export function shouldFetchLocalLoraConfigAfterConfigure(options: {
  skipLocalLoraConfig: boolean;
  configureTargetNodeNum: number | null;
  remoteAdminStatus: RemoteAdminStatus;
  loraConfig: MeshtasticLoraConfig | null;
}): boolean {
  if (options.skipLocalLoraConfig) return false;
  if (options.configureTargetNodeNum != null) return false;
  if (options.remoteAdminStatus === 'loading') return false;
  if (options.loraConfig != null) return false;
  return true;
}

/** Protobuf-free shared LoRa config → `Config.LoRaConfig` for `setConfig`. */
export function meshtasticLoraConfigToProtobuf(
  cfg: MeshtasticLoraConfig,
): Config.Config_LoRaConfig {
  return create(Config.Config_LoRaConfigSchema, cfg);
}
