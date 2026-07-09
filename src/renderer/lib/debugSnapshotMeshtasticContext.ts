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
}

const defaultMeshtasticContext: DebugSnapshotMeshtasticContext = {
  channelPills: [],
  channelConfigsSummary: [],
  mqttChannelKeyEntryCount: null,
};

let meshtasticContext: DebugSnapshotMeshtasticContext = { ...defaultMeshtasticContext };

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
