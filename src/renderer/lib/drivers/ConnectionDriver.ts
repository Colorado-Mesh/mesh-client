import { removeConnection, setConnection } from '../../stores/connectionStore';
import { clearDeviceIdentity } from '../../stores/deviceStore';
import {
  addIdentity,
  addTransport,
  findIdentityBySignature,
  getIdentity,
  removeIdentity as removeIdentityFromStore,
  removeTransport,
  setActiveIdentity,
  updateIdentity,
} from '../../stores/identityStore';
import { clearMessageIdentity } from '../../stores/messageStore';
import { clearNodeIdentity } from '../../stores/nodeStore';
import { meshcoreProtocol } from '../protocols/MeshCoreProtocol';
import { meshtasticProtocol } from '../protocols/MeshtasticProtocol';
import type { DiscoveryInfo, DomainEvent, Protocol } from '../protocols/Protocol';
import type {
  ConnectionType,
  IdentityId,
  TransportParams,
  TransportRef,
  TransportType,
} from '../types';
import { packetRouter } from './PacketRouter';

const PROTOCOLS: Record<string, Protocol> = {
  meshtastic: meshtasticProtocol,
  meshcore: meshcoreProtocol,
};

export function getProtocol(type: string): Protocol | null {
  return PROTOCOLS[type] ?? null;
}

interface TransportSlot {
  transportId: string;
  identityId: IdentityId;
  protocol: Protocol;
  handle: unknown;
  type: TransportType;
  params: TransportParams;
  teardown: () => void;
  lastDataAt: number;
}

function randomId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function transportTypeToConnectionType(type: TransportType): ConnectionType | null {
  switch (type) {
    case 'ble':
    case 'serial':
    case 'http':
      return type;
    default:
      return null;
  }
}

/**
 * Generic connection lifecycle owner. Holds the SDK handle registry, wires
 * protocol events into PacketRouter, and resolves identity signatures so that
 * reconnecting a previously-seen device reuses its existing store slices.
 *
 * Watchdog and reconnect-with-backoff are intentionally not yet implemented;
 * they layer on top of the slot registry's `lastDataAt`.
 */
export class ConnectionDriver {
  private slots = new Map<string, TransportSlot>();
  /** transport-key → identityId; persists identity across reconnects of the same physical device. */
  private transportKeyMap = new Map<string, IdentityId>();

  /** Resolve identity from transport and/or device-intrinsic signature keys. */
  lookupIdentityId(...keys: string[]): IdentityId | null {
    for (const key of keys) {
      if (!key) continue;
      const fromMap = this.transportKeyMap.get(key);
      if (fromMap && getIdentity(fromMap)) return fromMap;
      const fromStore = findIdentityBySignature(key);
      if (fromStore) {
        this.transportKeyMap.set(key, fromStore.id);
        return fromStore.id;
      }
    }
    return null;
  }

  /** Register all signature aliases for one identity (provisional transport + resolved node). */
  registerTransportKeys(identityId: IdentityId, ...keys: string[]): void {
    for (const key of keys) {
      if (key) this.transportKeyMap.set(key, identityId);
    }
  }

  /**
   * After Meshtastic `onMyNodeInfo`, map the node-intrinsic signature so reconnect
   * via transport key still resolves the same identity slice.
   */
  remapMeshtasticNodeSignature(
    identityId: IdentityId,
    params: TransportParams,
    myNodeNum: number,
  ): void {
    const provisionalKey = meshtasticProtocol.identitySignature(params);
    const resolvedKey = meshtasticProtocol.identitySignature(params, { myNodeNum });
    updateIdentity(identityId, { signature: resolvedKey, selfNodeNum: myNodeNum });
    this.registerTransportKeys(identityId, provisionalKey, resolvedKey);
  }

  async connect(protocolType: string, params: TransportParams): Promise<IdentityId> {
    const protocol = PROTOCOLS[protocolType];
    if (!protocol) throw new Error(`Unknown protocol: ${protocolType}`);

    const provisionalKey = protocol.identitySignature(params);
    let identityId = this.lookupIdentityId(provisionalKey) ?? '';
    let createdProvisional = false;

    if (!identityId || !getIdentity(identityId)) {
      identityId = randomId('id');
      addIdentity({
        id: identityId,
        protocol,
        signature: provisionalKey,
        transports: [],
        createdAt: Date.now(),
        lastSeenAt: Date.now(),
      });
      createdProvisional = true;
    }

    let handle: unknown;
    try {
      handle = await protocol.createDevice(params);
    } catch (err) {
      if (createdProvisional) removeIdentityFromStore(identityId);
      throw err;
    }

    let info: DiscoveryInfo | undefined;
    if (protocol.discoverSelf) {
      try {
        info = await protocol.discoverSelf(handle);
      } catch (err) {
        await protocol.destroyDevice(handle).catch(() => {});
        if (createdProvisional) removeIdentityFromStore(identityId);
        throw err;
      }
    }

    if (info) {
      const resolvedKey = protocol.identitySignature(params, info);
      if (resolvedKey !== provisionalKey) {
        const matched = findIdentityBySignature(resolvedKey);
        if (matched && matched.id !== identityId) {
          if (createdProvisional) removeIdentityFromStore(identityId);
          identityId = matched.id;
        }
      }
      updateIdentity(identityId, {
        signature: resolvedKey,
        publicKey: info.publicKey,
        selfNodeNum: info.myNodeNum,
      });
      this.registerTransportKeys(identityId, provisionalKey, resolvedKey);
    } else {
      this.registerTransportKeys(identityId, provisionalKey);
    }

    const transportId = randomId('t');
    const resolvedIdentityId = identityId;
    const teardown = protocol.subscribe(handle, (event: DomainEvent) => {
      const slot = this.slots.get(transportId);
      if (slot) slot.lastDataAt = Date.now();
      packetRouter.dispatch(event, resolvedIdentityId);
    });

    const transportRef: TransportRef = {
      transportId,
      type: params.type,
      status: 'connected',
      params,
      lastDataReceivedAt: Date.now(),
    };
    addTransport(identityId, transportRef);

    this.slots.set(transportId, {
      transportId,
      identityId,
      protocol,
      handle,
      type: params.type,
      params,
      teardown,
      lastDataAt: Date.now(),
    });

    setConnection(identityId, {
      status: 'connecting',
      connectionType: transportTypeToConnectionType(params.type),
    });
    setActiveIdentity(identityId);

    return identityId;
  }

  async disconnect(identityId: IdentityId): Promise<void> {
    const slotsToRemove = [...this.slots.values()].filter((s) => s.identityId === identityId);
    for (const slot of slotsToRemove) {
      try {
        slot.teardown();
      } catch (e) {
        console.debug('[ConnectionDriver] teardown error', e);
      }
      await slot.protocol.destroyDevice(slot.handle).catch((e: unknown) => {
        console.debug('[ConnectionDriver] destroy error', e);
      });
      this.slots.delete(slot.transportId);
      removeTransport(identityId, slot.transportId);
    }
    setConnection(identityId, { status: 'disconnected' });
  }

  /** "Forget this device": disconnects + clears every per-identity store slice. */
  async removeIdentity(identityId: IdentityId): Promise<void> {
    await this.disconnect(identityId);
    removeIdentityFromStore(identityId);
    removeConnection(identityId);
    clearMessageIdentity(identityId);
    clearNodeIdentity(identityId);
    clearDeviceIdentity(identityId);
    for (const [key, id] of this.transportKeyMap.entries()) {
      if (id === identityId) this.transportKeyMap.delete(key);
    }
  }

  /**
   * Attach a transport opened by legacy hooks (`useDevice` / `useMeshCore`) so
   * action hooks can resolve the live SDK handle. Caller supplies teardown from
   * `protocol.subscribe` (ingress is already wired before this call).
   */
  registerLegacyTransport(
    identityId: IdentityId,
    protocol: Protocol,
    handle: unknown,
    type: TransportType,
    params: TransportParams,
    teardown: () => void,
  ): () => void {
    const transportId = randomId('t');
    const transportRef: TransportRef = {
      transportId,
      type,
      status: 'connected',
      params,
      lastDataReceivedAt: Date.now(),
    };
    addTransport(identityId, transportRef);
    this.slots.set(transportId, {
      transportId,
      identityId,
      protocol,
      handle,
      type,
      params,
      teardown,
      lastDataAt: Date.now(),
    });
    this.registerTransportKeys(identityId, protocol.identitySignature(params));
    return () => {
      try {
        teardown();
      } catch (e) {
        console.debug('[ConnectionDriver] legacy teardown error', e);
      }
      this.slots.delete(transportId);
      removeTransport(identityId, transportId);
    };
  }

  /** Returns any live handle for the identity (first non-MQTT transport). Action hooks call this. */
  getHandle(identityId: IdentityId): unknown {
    const slot = [...this.slots.values()].find(
      (s) => s.identityId === identityId && s.type !== 'mqtt',
    );
    return slot?.handle ?? null;
  }

  /** Lookup a slot by transportId (for tests / debugging). */
  getSlot(transportId: string): TransportSlot | undefined {
    return this.slots.get(transportId);
  }
}

export const connectionDriver = new ConnectionDriver();
