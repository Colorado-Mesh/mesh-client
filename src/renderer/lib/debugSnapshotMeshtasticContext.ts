import { meshtasticMqttChannelKeyEntries } from '@/renderer/lib/meshtasticMqttPublish';
import { isMeshtasticDefaultPublicPsk } from '@/shared/meshtasticDefaultPublicPsk';

/** Channel pill row for debug snapshot triage (no PSK). */
export interface DebugSnapshotMeshtasticChannelPill {
  index: number;
  name: string;
}

/** Radio/MQTT channel config summary for debug snapshot triage (no PSK). */
export interface DebugSnapshotMeshtasticChannelConfigSummary {
  index: number;
  name: string;
  role: number;
  uplinkEnabled: boolean;
  isDefaultPublicPsk: boolean;
}

export interface DebugSnapshotMeshtasticContext {
  channelPills: DebugSnapshotMeshtasticChannelPill[];
  channelConfigsSummary: DebugSnapshotMeshtasticChannelConfigSummary[];
  /** Count from meshtasticMqttChannelKeyEntries when configs are known; null when empty. */
  mqttChannelKeyEntryCount: number | null;
  /**
   * Main-process topic channel name → local slot (from mqtt.getChannelNameToIndex).
   * Null when unknown / not yet fetched; empty object when MQTT map is empty.
   */
  mqttChannelNameToIndex: Record<string, number> | null;
}

export interface MeshtasticRuntimeChannelPillInput {
  index: number;
  name: string;
}

export interface MeshtasticRuntimeChannelConfigInput {
  index: number;
  name: string;
  role: number;
  uplinkEnabled?: boolean;
  psk: Uint8Array;
}

const defaultMeshtasticContext: DebugSnapshotMeshtasticContext = {
  channelPills: [],
  channelConfigsSummary: [],
  mqttChannelKeyEntryCount: null,
  mqttChannelNameToIndex: null,
};

let meshtasticContext: DebugSnapshotMeshtasticContext = { ...defaultMeshtasticContext };

/** Build Meshtastic debug snapshot context from runtime channel state (no PSK in output). */
export function buildDebugSnapshotMeshtasticContextFromRuntime(
  channels: MeshtasticRuntimeChannelPillInput[],
  channelConfigs: MeshtasticRuntimeChannelConfigInput[],
): DebugSnapshotMeshtasticContext {
  const keyEntries = meshtasticMqttChannelKeyEntries(channelConfigs);
  return {
    channelPills: channels.map((c) => ({ index: c.index, name: c.name })),
    channelConfigsSummary: channelConfigs.map((c) => ({
      index: c.index,
      name: c.name,
      role: c.role,
      uplinkEnabled: c.uplinkEnabled ?? false,
      isDefaultPublicPsk: isMeshtasticDefaultPublicPsk(c.psk),
    })),
    mqttChannelKeyEntryCount: keyEntries.length > 0 ? keyEntries.length : null,
    // Preserved via setDebugSnapshotMeshtasticContext merge from MQTT push / async snapshot fetch.
    mqttChannelNameToIndex: meshtasticContext.mqttChannelNameToIndex,
  };
}

/** Updated from App.tsx so debug snapshots capture Meshtastic channel layout for triage. */
export function setDebugSnapshotMeshtasticContext(
  partial: Partial<DebugSnapshotMeshtasticContext>,
): void {
  meshtasticContext = { ...meshtasticContext, ...partial };
}

export function getDebugSnapshotMeshtasticContext(): DebugSnapshotMeshtasticContext {
  return meshtasticContext;
}

/** Test helper — reset module state between cases. */
export function resetDebugSnapshotMeshtasticContext(): void {
  meshtasticContext = { ...defaultMeshtasticContext };
}
