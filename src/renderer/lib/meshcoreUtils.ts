import type { MeshNode } from './types';

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
};

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

const MESHCORE_REPEATER_AUTH_TOUCHED = 'meshclient:meshcoreRepeaterAuthTouched';
const MESHCORE_REPEATER_PASSWORD = 'meshclient:meshcoreRepeaterPassword';

/** Session-only repeater admin password from the optional prompt (for `login` before status/telemetry). */
export function meshcoreGetRepeaterSessionPassword(): string {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return '';
  try {
    return sessionStorage.getItem(MESHCORE_REPEATER_PASSWORD) ?? '';
  } catch {
    // catch-no-log-ok sessionStorage private mode / quota — return empty password
    return '';
  }
}

/**
 * Once per browser session, prompts for an optional repeater admin password before remote
 * telemetry/status/neighbors. Password is stored in sessionStorage for future wiring to the
 * transport; cancel aborts the action.
 */
export function meshcoreEnsureRepeaterRemoteAuthPrompt(): boolean {
  if (typeof window === 'undefined' || typeof sessionStorage === 'undefined') return true;
  try {
    if (sessionStorage.getItem(MESHCORE_REPEATER_AUTH_TOUCHED) === '1') return true;
    const r = window.prompt(
      'Optional repeater admin password for remote telemetry/status (leave empty if none). Stored for this session only.',
      sessionStorage.getItem(MESHCORE_REPEATER_PASSWORD) ?? '',
    );
    if (r === null) return false;
    sessionStorage.setItem(MESHCORE_REPEATER_AUTH_TOUCHED, '1');
    sessionStorage.setItem(MESHCORE_REPEATER_PASSWORD, r);
    return true;
  } catch {
    // catch-no-log-ok sessionStorage private mode / quota — fall through to unauthenticated requests
    return true;
  }
}
