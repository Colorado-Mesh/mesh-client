import type { MeshProtocol } from '@/shared/meshProtocol';

import type { ProtocolCapabilities } from './BaseRadioProvider';

/**
 * Features whose UI is gated by `ProtocolCapabilities` (or a missing local handler) and that
 * should explain *why* they are unavailable instead of silently hiding or greying out.
 * Add an id here, a matching `capabilityUnavailable.<id>.*` block in `en/translation.json`,
 * and a `FEATURE_DEFS` entry.
 */
export type CapabilityFeatureId =
  | 'factoryReset'
  | 'factoryResetConfig'
  | 'nodeDbReset'
  | 'shutdown'
  | 'rebootOta'
  | 'enterDfu'
  | 'firmwareFlash';

interface FeatureDef {
  /** True when `capabilities` supports the feature. Omitted = gated only by `handlerMissing`. */
  isSupported?: (capabilities: ProtocolCapabilities) => boolean;
  /** Protocols with a dedicated reason string (`capabilityUnavailable.<id>.<protocol>`). */
  protocolReasons: readonly MeshProtocol[];
}

const FEATURE_DEFS: Record<CapabilityFeatureId, FeatureDef> = {
  factoryReset: {
    isSupported: (c) => c.hasFactoryReset,
    protocolReasons: ['meshcore', 'reticulum'],
  },
  factoryResetConfig: {
    isSupported: (c) => c.hasFactoryReset,
    protocolReasons: ['meshcore'],
  },
  nodeDbReset: {
    isSupported: (c) => c.hasNodeDbReset,
    protocolReasons: ['meshcore'],
  },
  shutdown: {
    isSupported: (c) => c.hasShutdown,
    protocolReasons: ['meshcore'],
  },
  // OTA / DFU have no dedicated capability flag; the panel wires a handler only when the
  // protocol's firmware supports them, so callers pass `handlerMissing`.
  rebootOta: { protocolReasons: ['meshcore'] },
  enterDfu: { protocolReasons: ['meshcore'] },
  firmwareFlash: {
    isSupported: (c) => c.hasDeviceFirmwareFlash,
    protocolReasons: ['reticulum'],
  },
};

export interface CapabilityUnavailableReason {
  feature: CapabilityFeatureId;
  protocol: MeshProtocol;
  /** i18n key for a short, full-sentence reason (no interpolation). */
  reasonKey: string;
}

export interface CapabilityUnavailableOptions {
  /** The action's handler is not wired for this protocol/firmware even if the flag is on. */
  handlerMissing?: boolean;
}

/**
 * Returns why `feature` is unavailable for `capabilities`, or `null` when it is available.
 * Prefers a protocol-specific reason; falls back to `capabilityUnavailable.<id>.default`.
 */
export function getCapabilityUnavailableReason(
  capabilities: ProtocolCapabilities | undefined,
  feature: CapabilityFeatureId,
  options: CapabilityUnavailableOptions = {},
): CapabilityUnavailableReason | null {
  if (!capabilities) return null;
  const def = FEATURE_DEFS[feature];
  const unsupported = def.isSupported ? !def.isSupported(capabilities) : false;
  if (!unsupported && !options.handlerMissing) return null;

  const { protocol } = capabilities;
  const reasonKey = def.protocolReasons.includes(protocol)
    ? `capabilityUnavailable.${feature}.${protocol}`
    : `capabilityUnavailable.${feature}.default`;
  return { feature, protocol, reasonKey };
}
