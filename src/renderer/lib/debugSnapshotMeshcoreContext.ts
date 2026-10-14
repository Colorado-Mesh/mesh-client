import { getAppSettingsRaw } from '@/renderer/lib/appSettingsStorage';
import {
  FLOOD_SCOPE_OVERRIDE_UNSCOPED,
  loadFloodScopeOverridesInitial,
} from '@/renderer/lib/chatPanelProtocolStorage';
import { getMeshcoreRadioMaxContacts } from '@/renderer/lib/meshcore/meshcoreContactCapacityPush';
import type { MeshCoreSelfInfo } from '@/renderer/lib/meshcore/meshcoreHookTypes';
import { parseStoredJson } from '@/renderer/lib/parseStoredJson';
import type { DeviceState } from '@/renderer/lib/types';

/** Live radio settings pushed from the MeshCore runtime (null fields until connected). */
export interface DebugSnapshotMeshcoreRadioLive {
  radioFreq: number | null;
  radioBw: number | null;
  radioSf: number | null;
  radioCr: number | null;
  txPower: number | null;
  manualAddContacts: boolean | null;
  firmwareVersion: string | null;
  pathHashMode: number | null;
  /** Contacts returned by the last radio `getContacts`. */
  radioContactCount: number | null;
}

export interface DebugSnapshotMeshcoreRadioContext extends DebugSnapshotMeshcoreRadioLive {
  radioMaxContacts: number;
  /** Radio-wide flood scope hashtag from app settings; empty = unscoped. */
  floodScopeRadioDefault: string;
  /** Per chat view (channel / DM) overrides; `FLOOD_SCOPE_OVERRIDE_UNSCOPED` = explicitly unscoped. */
  floodScopeOverrides: Record<string, string>;
}

const defaultLive: DebugSnapshotMeshcoreRadioLive = {
  radioFreq: null,
  radioBw: null,
  radioSf: null,
  radioCr: null,
  txPower: null,
  manualAddContacts: null,
  firmwareVersion: null,
  pathHashMode: null,
  radioContactCount: null,
};

let live: DebugSnapshotMeshcoreRadioLive = { ...defaultLive };

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map runtime selfInfo / device state to the snapshot's live radio fields. */
export function buildDebugSnapshotMeshcoreRadioLive(
  selfInfo: Partial<MeshCoreSelfInfo> | null,
  state: Pick<DeviceState, 'firmwareVersion' | 'pathHashMode'>,
  radioContactCount: number | null,
): DebugSnapshotMeshcoreRadioLive {
  return {
    radioFreq: numOrNull(selfInfo?.radioFreq),
    radioBw: numOrNull(selfInfo?.radioBw),
    radioSf: numOrNull(selfInfo?.radioSf),
    radioCr: numOrNull(selfInfo?.radioCr),
    txPower: numOrNull(selfInfo?.txPower),
    manualAddContacts:
      typeof selfInfo?.manualAddContacts === 'boolean' ? selfInfo.manualAddContacts : null,
    firmwareVersion: state.firmwareVersion ?? null,
    pathHashMode: numOrNull(state.pathHashMode),
    radioContactCount,
  };
}

/** Updated from the MeshCore runtime so debug snapshots capture radio settings for triage. */
export function setDebugSnapshotMeshcoreRadioLive(next: DebugSnapshotMeshcoreRadioLive): void {
  live = next;
}

function loadFloodScopeRadioDefault(): string {
  const settings = parseStoredJson<{ meshcoreFloodScopeHashtag?: unknown }>(
    getAppSettingsRaw(),
    'debugSnapshot meshcoreFloodScopeHashtag',
  );
  return typeof settings?.meshcoreFloodScopeHashtag === 'string'
    ? settings.meshcoreFloodScopeHashtag.trim()
    : '';
}

export function getDebugSnapshotMeshcoreRadioContext(): DebugSnapshotMeshcoreRadioContext {
  return {
    ...live,
    radioMaxContacts: getMeshcoreRadioMaxContacts(),
    floodScopeRadioDefault: loadFloodScopeRadioDefault(),
    floodScopeOverrides: { ...loadFloodScopeOverridesInitial('meshcore') },
  };
}

/** True when neither the radio default nor any chat view applies a named flood scope. */
export function isMeshcoreFloodFullyUnscoped(ctx: DebugSnapshotMeshcoreRadioContext): boolean {
  if (ctx.floodScopeRadioDefault) return false;
  return !Object.values(ctx.floodScopeOverrides).some(
    (v) => v !== FLOOD_SCOPE_OVERRIDE_UNSCOPED && v.trim() !== '',
  );
}

/** Test helper — reset module state between cases. */
export function resetDebugSnapshotMeshcoreContext(): void {
  live = { ...defaultLive };
}
