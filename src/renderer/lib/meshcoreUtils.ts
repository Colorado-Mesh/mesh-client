import type { ConnectionType, MeshNode } from './types';

const MESHCORE_COORD_SCALE = 1e6;

/** Reserved range for channel / unknown-sender chat stubs (name-only, no pubkey). */
export const MESHCORE_CHAT_STUB_ID_MIN = 0xa0000000 >>> 0;
export const MESHCORE_CHAT_STUB_ID_MAX = 0xafffffff >>> 0;

const SYNTH_PLACEHOLDER_PUBKEY_MARKER_HEX = '4d434854'; // "MCHT"

/**
 * Stable pseudo node id for MeshCore channel traffic where only a display name is known.
 * Collisions with real pubkey-derived ids are unlikely but possible.
 */
export function meshcoreChatStubNodeIdFromDisplayName(name: string): number {
  const trimmed = (name || '').trim() || 'Unknown';
  let h = 2166136261 >>> 0;
  for (let i = 0; i < trimmed.length; i++) {
    h ^= trimmed.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (MESHCORE_CHAT_STUB_ID_MIN | (h & 0x0fffffff)) >>> 0;
}

export function meshcoreIsChatStubNodeId(nodeId: number): boolean {
  const u = nodeId >>> 0;
  return u >= MESHCORE_CHAT_STUB_ID_MIN && u <= MESHCORE_CHAT_STUB_ID_MAX;
}

/** MeshCore companion lines that are transport metadata, not user channel chat (splitting on `:` would mispick `SNR:`). */
export function isMeshcoreTransportStatusChatLine(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  if (/^\s*ack\s+@/iu.test(t)) return true;
  if (/^\s*nack\s+@/iu.test(t)) return true;
  return false;
}

/**
 * After `buildNodesFromContacts` replaces the node map, re-attach name-only RF/MQTT channel
 * stubs so they are not dropped. Skips stub ids that now exist on the device (real contact wins).
 */
export function mergeMeshcoreChatStubNodes(
  prev: Map<number, MeshNode>,
  deviceNodes: Map<number, MeshNode>,
): Map<number, MeshNode> {
  const next = new Map(deviceNodes);
  for (const [id, node] of prev) {
    if (meshcoreIsChatStubNodeId(id) && !deviceNodes.has(id)) {
      next.set(id, node);
    }
  }
  return next;
}

/** Placeholder pubkey stored until a real contact (0x8A) replaces the row. */
export function meshcoreSyntheticPlaceholderPubKeyHex(nodeId: number): string {
  const b = new Uint8Array(32);
  b[0] = 0x4d;
  b[1] = 0x43;
  b[2] = 0x48;
  b[3] = 0x54;
  new DataView(b.buffer).setUint32(4, nodeId >>> 0, false);
  for (let i = 8; i < 32; i++) {
    b[i] = (((nodeId >>> 0) + i) * 17) & 0xff;
  }
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function meshcoreIsSyntheticPlaceholderPubKeyHex(hex: string): boolean {
  const h = hex.replace(/\s/g, '').toLowerCase();
  return h.length === 64 && h.startsWith(SYNTH_PLACEHOLDER_PUBKEY_MARKER_HEX);
}

export function minimalMeshcoreChatNode(
  nodeId: number,
  displayName: string,
  lastHeardSec: number,
  via: 'rf' | 'mqtt',
): MeshNode {
  const name = displayName.trim() || `Node-${nodeId.toString(16).toUpperCase()}`;
  return {
    node_id: nodeId,
    long_name: name,
    short_name: '',
    hw_model: 'Chat',
    snr: 0,
    battery: 0,
    last_heard: lastHeardSec,
    latitude: null,
    longitude: null,
    source: via,
    heard_via_mqtt_only: via === 'mqtt',
  };
}

/**
 * XOR-fold pubkey bytes into a stable unsigned 32-bit node ID.
 * Expects a 32-byte MeshCore public key; returns 0 for any other length.
 */
export function pubkeyToNodeId(key: Uint8Array): number {
  if (key.length !== 32) return 0;
  let result = 0;
  for (let i = 0; i < key.length; i += 4) {
    const word =
      key[i] | 0 | ((key[i + 1] | 0) << 8) | ((key[i + 2] | 0) << 16) | ((key[i + 3] | 0) << 24);
    result = (result ^ word) >>> 0;
  }
  return result >>> 0;
}

export const CONTACT_TYPE_LABELS: Record<number, string> = {
  0: 'None',
  1: 'Chat',
  2: 'Repeater',
  3: 'Room',
  4: 'Sensor',
};

/**
 * Map measured cell voltage to an approximate 0–100% for UI (e.g. node list bar).
 * Uses a simple 1S LiPo-style linear range (3.5 V empty → 4.2 V full); not accurate for all chemistries or loads.
 */
export function meshcoreMilliVoltsToApproximateBatteryPercent(milliVolts: number): number {
  if (!Number.isFinite(milliVolts) || milliVolts <= 0) return 0;
  const v = milliVolts / 1000;
  const emptyV = 3.5;
  const fullV = 4.2;
  const pct = ((v - emptyV) / (fullV - emptyV)) * 100;
  return Math.round(Math.min(100, Math.max(0, pct)));
}

/**
 * MeshCore / meshcore.js expose only `batteryMilliVolts`—no charging or USB-powered flag (contrast: Meshtastic uses batteryLevel > 100).
 * For UI we treat USB serial as likely VBUS/charging. BLE or TCP cannot indicate wall-charging without firmware support.
 */
export function meshcoreConnectionImpliesUsbPower(connectionType: ConnectionType | null): boolean {
  return connectionType === 'serial';
}

/** MeshCore roles excluded from user contact-group membership (infrastructure / rooms). */
export const MESHCORE_HW_MODELS_EXCLUDED_FROM_CONTACT_GROUPS: ReadonlySet<string> = new Set([
  CONTACT_TYPE_LABELS[2],
  CONTACT_TYPE_LABELS[3],
]);

export function isMeshcoreContactEligibleForUserGroup(node: Pick<MeshNode, 'hw_model'>): boolean {
  const hw = node.hw_model ?? '';
  return !MESHCORE_HW_MODELS_EXCLUDED_FROM_CONTACT_GROUPS.has(hw);
}

interface MeshCoreContact {
  publicKey: Uint8Array;
  type: number;
  advName: string;
  lastAdvert: number;
  advLat: number;
  advLon: number;
  flags?: number;
  outPathLen?: number;
}

export function meshcoreContactToMeshNode(contact: MeshCoreContact): MeshNode {
  const nodeId = pubkeyToNodeId(contact.publicKey);
  const lat = contact.advLat !== 0 ? contact.advLat / MESHCORE_COORD_SCALE : null;
  const lon = contact.advLon !== 0 ? contact.advLon / MESHCORE_COORD_SCALE : null;
  return {
    node_id: nodeId,
    long_name: contact.advName || `Node-${nodeId.toString(16).toUpperCase()}`,
    short_name: '',
    hw_model: CONTACT_TYPE_LABELS[contact.type] ?? 'Unknown',
    snr: 0,
    battery: 0,
    last_heard: contact.lastAdvert,
    latitude: lat,
    longitude: lon,
    hops_away:
      contact.outPathLen != null && contact.outPathLen >= 0 ? contact.outPathLen : undefined,
  };
}

/** Result of mapping a heard RF advert (push 0x80) into UI + DB when the node is not yet a contact. */
export interface MeshcoreMinimalAdvertNodeResult {
  node: MeshNode;
  lastHeardSec: number;
  persistAdvLatDeg: number | null;
  persistAdvLonDeg: number | null;
  contactType: number;
}

/**
 * Build a minimal {@link MeshNode} from an advert public key and optional companion fields.
 * Returns null if the key is not a valid 32-byte MeshCore pubkey or folds to node id 0.
 */
export function meshcoreMinimalNodeFromAdvertEvent(
  publicKey: Uint8Array,
  opts: {
    nowSec: number;
    advLat?: number;
    advLon?: number;
    lastAdvert?: number;
    contactType?: number;
    advName?: string;
  },
): MeshcoreMinimalAdvertNodeResult | null {
  if (publicKey.length !== 32) return null;
  const nodeId = pubkeyToNodeId(publicKey);
  if (nodeId === 0) return null;
  const contactType =
    typeof opts.contactType === 'number' && Number.isFinite(opts.contactType)
      ? Math.max(0, Math.floor(opts.contactType))
      : 0;
  const hasLat =
    typeof opts.advLat === 'number' && Number.isFinite(opts.advLat) && opts.advLat !== 0;
  const hasLon =
    typeof opts.advLon === 'number' && Number.isFinite(opts.advLon) && opts.advLon !== 0;
  const lastHeardSec =
    typeof opts.lastAdvert === 'number' && Number.isFinite(opts.lastAdvert) && opts.lastAdvert > 0
      ? opts.lastAdvert
      : opts.nowSec;
  const latDeg = hasLat ? opts.advLat! / MESHCORE_COORD_SCALE : null;
  const lonDeg = hasLon ? opts.advLon! / MESHCORE_COORD_SCALE : null;
  const advNameTrim =
    typeof opts.advName === 'string' && opts.advName.trim() ? opts.advName.trim() : '';
  const node: MeshNode = {
    node_id: nodeId,
    long_name: advNameTrim || `Node-${nodeId.toString(16).toUpperCase()}`,
    short_name: '',
    hw_model: CONTACT_TYPE_LABELS[contactType] ?? 'Unknown',
    snr: 0,
    battery: 0,
    last_heard: lastHeardSec,
    latitude: latDeg,
    longitude: lonDeg,
  };
  return {
    node,
    lastHeardSec,
    persistAdvLatDeg: latDeg,
    persistAdvLonDeg: lonDeg,
    contactType,
  };
}

/** MeshCore supports channel indices 0..39 (40 channels). */
export const MESHCORE_CHANNEL_INDEX_MAX = 39;

/**
 * 128-bit AES key as 32 hex chars: first 16 bytes of SHA-256("#name") per MeshCore #channel convention.
 * The name is normalized with a leading `#` (e.g. `general` → hash `#general`).
 */
export async function meshcoreDeriveChannelKeyHexFromName(channelName: string): Promise<string> {
  const t = channelName.trim();
  const input = t.startsWith('#') ? t : `#${t}`;
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  const first16 = new Uint8Array(buf).slice(0, 16);
  return Array.from(first16, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Normalize `getSelfInfo().radioFreq` to Hz for UI (`RadioPanel` MHz field).
 * Firmware may report Hz (≥1e8), kHz (ISM band as integer, e.g. 910525), or MHz (float, e.g. 915.5).
 */
export function meshcoreSelfInfoFreqToDisplayHz(freq: number): number {
  if (!Number.isFinite(freq) || freq <= 0) return 915_000_000;
  if (freq >= 1e8) return Math.round(freq);
  if (freq >= 100_000 && freq < 1e8) return Math.round(freq * 1000);
  return Math.round(freq * 1e6);
}

/**
 * Normalize `getSelfInfo().radioBw` to kHz for `ConfigSelect` bandwidth state.
 * Firmware may report Hz (≥1000, e.g. 250000) or kHz (125, 250, 500).
 */
export function meshcoreSelfInfoBwToDisplayKhz(bw: number): number {
  if (!Number.isFinite(bw) || bw <= 0) return 250;
  if (bw >= 1000) return Math.round(bw / 1000);
  return Math.round(bw);
}

const REPEATER_AUTH_HINT =
  'Set or change the repeater admin password from the Repeaters panel (session only).';

/**
 * Raw SNR from MeshCore `getStatus` / `tracePath` uses the same quarter-dB scaling as trace hops.
 * @see tracePath mapping in useMeshCore (`lastSnr * 0.25`)
 */
export const MESHCORE_RPC_SNR_RAW_TO_DB = 0.25;

// In-memory only — never written to any persistent or inspectable storage.
let _repeaterAuthTouched = false;
let _repeaterPassword = '';

/** True after the user completed the Repeaters remote-auth step for this session (password or skip). */
export function meshcoreIsRepeaterRemoteAuthTouched(): boolean {
  return _repeaterAuthTouched;
}

/** Session-only repeater admin password (for `login` before status/telemetry/neighbors). */
export function meshcoreGetRepeaterSessionPassword(): string {
  return _repeaterPassword;
}

/** Store password and mark session auth as configured. */
export function meshcoreApplyRepeaterSessionAuth(password: string): void {
  _repeaterPassword = password;
  _repeaterAuthTouched = true;
}

/** Mark session auth as configured with no password (repeaters without admin password). */
export function meshcoreApplyRepeaterSessionAuthSkip(): void {
  _repeaterPassword = '';
  _repeaterAuthTouched = true;
}

/** Clear session repeater auth so the user can re-enter or skip again. */
export function meshcoreClearRepeaterRemoteSessionAuth(): void {
  _repeaterAuthTouched = false;
  _repeaterPassword = '';
}

/** Append guidance when an error is likely auth-related. */
export function meshcoreAppendRepeaterAuthHint(message: string): string {
  const m = message.trim();
  if (!m) return m;
  if (m.includes(REPEATER_AUTH_HINT)) return m;
  const lower = m.toLowerCase();
  const authish =
    lower.includes('authentication failed') ||
    lower.includes('auth failed') ||
    lower.includes('login failed') ||
    (lower.includes('auth') && lower.includes('fail'));
  if (!authish) return m;
  return `${m} ${REPEATER_AUTH_HINT}`;
}
