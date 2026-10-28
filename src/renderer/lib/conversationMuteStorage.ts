import { useConnectionStore } from '../stores/connectionStore';
import { useIdentityStore } from '../stores/identityStore';
import { getLiveChannelKeys } from '../stores/liveChannelKeyStore';
import { useNodeStore } from '../stores/nodeStore';
import { useReticulumIdentityStore } from '../stores/reticulumIdentityStore';
import { getNotificationIdentity } from './chatNotificationPolicy';
import { resolvePrimaryIdentityIdForProtocol } from './identityByProtocol';
import { getMeshcorePubKey } from './meshcore/meshcorePubKeyRegistry';
import { pubkeyToNodeId } from './meshcoreUtils';
import { notificationMqttChannelKeys } from './notificationMqttChannelKeys';
import { resolveReticulumDestinationHash } from './reticulum/destHash';
import { rrcRoomMatchKey, rrcRoomsMatch } from './rrcRoomName';
import type { MeshProtocol } from './types';

export const CONVERSATION_MUTES_KEY = 'mesh-client:conversationMutes:v1';
const mqttClientIds = new Map<MeshProtocol, string>();

/** Public, main-owned client ids are stable per install; no broker credentials are cached. */
export function setConversationMuteMqttClientId(protocol: MeshProtocol, clientId: string): void {
  const valid =
    protocol === 'meshtastic'
      ? /^meshtastic-electron-[0-9a-f]{16}$/.test(clientId)
      : protocol === 'meshcore' && /^(meshcore-mqtt-[0-9a-f]{16}|v1_[0-9a-f]{64})$/i.test(clientId);
  if (valid) mqttClientIds.set(protocol, clientId.toLowerCase());
  else mqttClientIds.delete(protocol);
}

function notificationConnection(protocol: MeshProtocol) {
  const id = getNotificationIdentity(protocol)?.id;
  return id ? useConnectionStore.getState().connections[id] : undefined;
}

interface MuteEntry {
  protocol: MeshProtocol;
  device: string;
  view: string;
  target: string;
  muted: boolean;
  legacyView?: string;
  legacyViews?: string[];
}

function legacyViews(entry: MuteEntry): string[] {
  return [
    ...new Set([
      ...(typeof entry.legacyView === 'string' ? [entry.legacyView] : []),
      ...(Array.isArray(entry.legacyViews)
        ? entry.legacyViews.filter((view) => typeof view === 'string')
        : []),
    ]),
  ];
}

function readEntries(): MuteEntry[] {
  const raw = localStorage.getItem(CONVERSATION_MUTES_KEY);
  if (!raw) return [];
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Invalid conversation mute preferences');
  return parsed.filter((entry: unknown): entry is MuteEntry => {
    if (!entry || typeof entry !== 'object') return false;
    const e = entry as Partial<MuteEntry>;
    return (
      ['meshtastic', 'meshcore', 'reticulum'].includes(e.protocol ?? '') &&
      typeof e.device === 'string' &&
      typeof e.view === 'string' &&
      typeof e.target === 'string' &&
      typeof e.muted === 'boolean'
    );
  });
}

function notificationDeviceSignature(protocol: MeshProtocol): string {
  if (protocol === 'reticulum') {
    return useReticulumIdentityStore.getState().identity?.lxmf_hash.toLowerCase() ?? '';
  }
  const { identities, activeIdentityId } = useIdentityStore.getState();
  const id = resolvePrimaryIdentityIdForProtocol(identities, activeIdentityId, protocol);
  const signature = id ? identities[id].signature : '';
  const ready = protocol === 'meshtastic' ? /^meshtastic:node:\d+$/ : /^meshcore:pk:[0-9a-f]{64}$/i;
  const primaryConnection = id ? useConnectionStore.getState().connections[id] : undefined;
  const connection = notificationConnection(protocol);
  if (
    connection?.status === 'disconnected' &&
    connection.mqttStatus === 'connected' &&
    (!signature || ready.test(signature)) &&
    (!primaryConnection || primaryConnection.status === 'disconnected')
  ) {
    const clientId = mqttClientIds.get(protocol);
    return clientId ? `${protocol}:mqtt:client:${clientId}` : '';
  }
  // Hydrated peer data can live in the offline bucket while the radio owns the
  // finalized signature. Never use a display-bucket fallback as device identity.
  return ready.test(signature) ? signature.toLowerCase() : '';
}

// Chat keeps its last channel layout visible while RF is disconnected.
const retainedLayouts = new Map<string, Readonly<Record<number, string>>>();
function notificationChannelKeys(protocol: MeshProtocol): Readonly<Record<number, string>> | null {
  if (protocol === 'reticulum') return null;
  const device = notificationDeviceSignature(protocol);
  if (!device) return null;
  const live = getLiveChannelKeys(protocol);
  const radioNodeId = device.includes(':mqtt:client:')
    ? notificationConnection(protocol)?.myNodeNum
    : protocol === 'meshtastic'
      ? Number(device.slice('meshtastic:node:'.length))
      : pubkeyToNodeId(
          Uint8Array.from(device.slice('meshcore:pk:'.length).match(/../g) ?? [], (byte) =>
            Number.parseInt(byte, 16),
          ),
        );
  if (radioNodeId == null || radioNodeId <= 0) return null;
  if (protocol === 'meshtastic' && device.includes(':mqtt:client:')) {
    // Canonical MQTT settings own this namespace; a stale RF map must not.
    const keys = notificationMqttChannelKeys();
    return Object.keys(keys).length > 0 ? keys : null;
  }
  if (live?.radioNodeId != null && live.radioNodeId !== radioNodeId) return null;
  if (live?.radioNodeId === radioNodeId && Object.keys(live.keyByIndex).length > 0) {
    retainedLayouts.set(device, live.keyByIndex);
    return live.keyByIndex;
  }
  return retainedLayouts.get(device) ?? null;
}

function binding(protocol: MeshProtocol, view: string): Omit<MuteEntry, 'muted'> | null {
  // RRC room identity is the full hub destination plus its canonical room name.
  if (view.startsWith('rrc:')) {
    const [, hub, ...room] = view.split(':');
    if (!hub || !room.length) return null;
    return {
      protocol,
      device: hub.toLowerCase(),
      view,
      target: rrcRoomMatchKey(room.join(':')),
    };
  }
  const identity = getNotificationIdentity(protocol);
  const keys = notificationChannelKeys(protocol);
  const device = notificationDeviceSignature(protocol);
  if (!device) return null;
  if (view.startsWith('ch:')) {
    const target = keys?.[Number(view.slice(3))];
    return target ? { protocol, device, view, target } : null;
  }
  const [kind, id] = view.split(':');
  if ((kind !== 'dm' && kind !== 'room') || !id) return null;
  const node = identity
    ? new Map(Object.entries(useNodeStore.getState().nodes)).get(identity.id)?.[Number(id)]
    : undefined;
  const publicKey = node?.publicKey ?? getMeshcorePubKey(Number(id));
  const publicKeyHex = node?.publicKeyHex;
  const target =
    protocol === 'meshtastic'
      ? id
      : protocol === 'reticulum'
        ? resolveReticulumDestinationHash(Number(id), node?.reticulumDestinationHash)
        : publicKeyHex && /^[0-9a-f]{64}$/i.test(publicKeyHex)
          ? publicKeyHex
          : publicKey?.length === 32
            ? Array.from(publicKey, (b) => b.toString(16).padStart(2, '0')).join('')
            : null;
  return target ? { protocol, device, view, target: `${kind}:${target.toLowerCase()}` } : null;
}

function sameBinding(a: Omit<MuteEntry, 'muted'>, b: Omit<MuteEntry, 'muted'>): boolean {
  return (
    a.protocol === b.protocol &&
    a.device === b.device &&
    a.target === b.target &&
    a.view.split(':')[0] === b.view.split(':')[0]
  );
}

/** Automatic view remaps wait for discovery instead of reporting a user save failure. */
export function canBindConversationMute(protocol: MeshProtocol, view: string): boolean {
  return binding(protocol, view) != null;
}

/** Project stable preferences into the legacy UI key space without rewriting legacy data. */
export function projectConversationMutes(protocol: MeshProtocol, legacy: Set<string>): Set<string> {
  const result = new Set(legacy);
  try {
    const entries = readEntries();
    for (const entry of entries) {
      if (entry.protocol === protocol) {
        for (const view of legacyViews(entry)) result.delete(view);
      }
    }
    for (const entry of entries) {
      if (entry.protocol !== protocol) continue;
      let views = [entry.view];
      if (entry.view.startsWith('ch:') && protocol !== 'reticulum') {
        const keys = notificationChannelKeys(protocol);
        if (keys) {
          views = Object.entries(keys)
            .filter(([, key]) => key === entry.target)
            .map(([slot]) => `ch:${slot}`);
        }
      }
      for (const view of views) {
        const current = binding(protocol, view);
        // A persisted full peer key remains muted while contacts reload. Once metadata
        // exists, verify it so an id collision cannot inherit another peer's preference.
        const waitingForPeer =
          !current &&
          /^(dm|room):/.test(view) &&
          notificationDeviceSignature(protocol) === entry.device;
        if (!waitingForPeer && (!current || !sameBinding(current, entry))) continue;
        if (view.startsWith('rrc:')) {
          for (const key of result) {
            const [, hub, ...room] = key.split(':');
            if (
              key.startsWith('rrc:') &&
              hub.toLowerCase() === entry.device &&
              rrcRoomsMatch(room.join(':'), entry.target)
            )
              result.delete(key);
          }
        }
        if (entry.muted) result.add(view);
        else result.delete(view);
      }
    }
  } catch (error) {
    console.warn('[conversationMuteStorage] read failed; preserving legacy mutes', error);
  }
  return result;
}

/** One atomic write. Failed writes leave both the UI and saved preferences unchanged. */
export function saveConversationMutes(
  protocol: MeshProtocol,
  before: ReadonlySet<string>,
  after: ReadonlySet<string>,
): boolean {
  try {
    let entries = readEntries();
    let changed = false;
    for (const view of new Set([...before, ...after])) {
      if (before.has(view) === after.has(view)) continue;
      changed = true;
      const current =
        binding(protocol, view) ??
        entries.find(
          (entry) =>
            entry.protocol === protocol &&
            entry.device === notificationDeviceSignature(protocol) &&
            entry.view === view &&
            /^(dm|room):/.test(view),
        );
      if (!current) throw new Error('Conversation identity is not ready');
      const previous = entries.find((entry) => sameBinding(entry, current));
      entries = entries.filter((entry) => !sameBinding(entry, current));
      entries.push({
        ...current,
        muted: after.has(view),
        legacyView: previous?.legacyView ?? view,
        legacyViews: [...new Set([...(previous ? legacyViews(previous) : []), view])],
      });
    }
    if (changed) localStorage.setItem(CONVERSATION_MUTES_KEY, JSON.stringify(entries));
    return true;
  } catch (error) {
    console.warn('[conversationMuteStorage] save failed', error);
    return false;
  }
}

/** Bind old slot-based choices once discovery supplies a stable conversation identity.
 * The legacy document stays intact for rollback; migration metadata prevents it leaking
 * into a different radio/channel after a successful atomic save.
 */
export function migrateLegacyConversationMutes(protocol: MeshProtocol): boolean {
  try {
    const raw = localStorage.getItem(`mesh-client:mutedViews:${protocol}`);
    if (!raw) return false;
    const legacy: unknown = JSON.parse(raw);
    if (!Array.isArray(legacy)) return false;
    const entries = readEntries();
    let changed = false;
    for (const view of legacy) {
      if (
        typeof view !== 'string' ||
        entries.some((e) => e.protocol === protocol && legacyViews(e).includes(view))
      )
        continue;
      const current = binding(protocol, view);
      if (!current) continue;
      const existing = entries.find((entry) => sameBinding(entry, current));
      if (existing) existing.legacyViews = [...new Set([...legacyViews(existing), view])];
      else entries.push({ ...current, muted: true, legacyView: view });
      changed = true;
    }
    if (!changed) return false;
    localStorage.setItem(CONVERSATION_MUTES_KEY, JSON.stringify(entries));
    return true;
  } catch (error) {
    console.warn('[conversationMuteStorage] migration deferred; preserving legacy mutes', error);
    return false;
  }
}
