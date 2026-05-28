import type { Connection } from '@liamcottle/meshcore.js';
import type { MeshDevice } from '@meshtastic/core';

import { randomCorrelationSuffix } from '@/shared/randomCorrelationSuffix';

import { setConnection } from '../stores/connectionStore';
import {
  addIdentity,
  findIdentityBySignature,
  setActiveIdentity,
  updateIdentity,
} from '../stores/identityStore';
import { connectionDriver } from './drivers/ConnectionDriver';
import { packetRouter } from './drivers/PacketRouter';
import { tryReuseOfflineProtocolIdentity } from './offlineProtocolIdentities';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';
import { meshtasticProtocol } from './protocols/MeshtasticProtocol';
import type { DiscoveryInfo } from './protocols/Protocol';
import type { ConnectionType, IdentityId, TransportParams } from './types';

function randomIdentityId(prefix: string): IdentityId {
  return `${prefix}-${Date.now()}-${randomCorrelationSuffix()}`;
}

function resolveOrCreateIdentity(
  protocol: typeof meshtasticProtocol | typeof meshcoreProtocol,
  params: TransportParams,
  discovery?: DiscoveryInfo,
): IdentityId {
  const provisionalKey = protocol.identitySignature(params);
  const resolvedKey = discovery ? protocol.identitySignature(params, discovery) : provisionalKey;
  const existing =
    connectionDriver.lookupIdentityId(resolvedKey, provisionalKey) ??
    findIdentityBySignature(resolvedKey)?.id ??
    findIdentityBySignature(provisionalKey)?.id ??
    null;
  if (existing) {
    connectionDriver.registerTransportKeys(existing, provisionalKey, resolvedKey);
    return existing;
  }
  const reusableOffline = tryReuseOfflineProtocolIdentity(protocol.type);
  if (reusableOffline) {
    updateIdentity(reusableOffline, {
      signature: resolvedKey,
      lastSeenAt: Date.now(),
      ...(discovery?.myNodeNum != null ? { selfNodeNum: discovery.myNodeNum } : {}),
      ...(discovery?.publicKey ? { publicKey: discovery.publicKey } : {}),
    });
    connectionDriver.registerTransportKeys(reusableOffline, provisionalKey, resolvedKey);
    return reusableOffline;
  }
  const identityId = randomIdentityId(protocol.type);
  addIdentity({
    id: identityId,
    protocol,
    signature: resolvedKey,
    transports: [],
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });
  connectionDriver.registerTransportKeys(identityId, provisionalKey, resolvedKey);
  return identityId;
}

export interface MeshtasticIngressBind {
  identityId: IdentityId;
  detach: () => void;
}

export function meshtasticTransportParams(
  type: ConnectionType,
  opts: { peripheralId?: string; portSignature?: string; host?: string },
): TransportParams {
  switch (type) {
    case 'ble':
      return { type: 'ble', peripheralId: opts.peripheralId };
    case 'serial':
      return { type: 'serial', portSignature: opts.portSignature };
    case 'http':
      return { type: 'http', host: opts.host ?? '' };
    default: {
      const _exhaustive: never = type;
      throw new Error(
        `meshtasticTransportParams: unsupported connection type ${String(_exhaustive)}`,
      );
    }
  }
}

/**
 * Registers a Meshtastic identity, wires protocol ingress into PacketRouter,
 * and exposes the SDK handle to ConnectionDriver action hooks.
 */
export function bindMeshtasticIngress(
  device: MeshDevice,
  type: ConnectionType,
  opts: { peripheralId?: string; portSignature?: string; host?: string },
  discovery?: DiscoveryInfo,
): MeshtasticIngressBind {
  const params = meshtasticTransportParams(type, opts);
  const identityId = resolveOrCreateIdentity(meshtasticProtocol, params, discovery);
  if (discovery?.myNodeNum != null && discovery.myNodeNum > 0) {
    connectionDriver.remapMeshtasticNodeSignature(identityId, params, discovery.myNodeNum);
    if (discovery.publicKey) {
      updateIdentity(identityId, { publicKey: discovery.publicKey });
    }
  }
  setConnection(identityId, { status: 'connecting', connectionType: type });
  setActiveIdentity(identityId);

  const teardown = meshtasticProtocol.subscribe(device, (event) => {
    packetRouter.dispatch(event, identityId);
  });
  const detachDriver = connectionDriver.registerLegacyTransport(
    identityId,
    meshtasticProtocol,
    device,
    type,
    params,
    teardown,
  );

  return { identityId, detach: detachDriver };
}

/** After driver connect + `getSelfInfo`, align identity signature with resolved node id. */
export function finalizeMeshcoreDriverIdentity(
  identityId: IdentityId,
  params: TransportParams,
  discovery: DiscoveryInfo,
): void {
  const provisionalKey = meshcoreProtocol.identitySignature(params);
  const resolvedKey = meshcoreProtocol.identitySignature(params, discovery);
  updateIdentity(identityId, {
    signature: resolvedKey,
    selfNodeNum: discovery.myNodeNum,
    publicKey: discovery.publicKey,
  });
  connectionDriver.registerTransportKeys(identityId, provisionalKey, resolvedKey);
}

export interface MeshcoreIngressBind {
  identityId: IdentityId;
  detach: () => void;
}

export function meshcoreTransportParams(
  type: 'ble' | 'serial' | 'tcp',
  opts: { peripheralId?: string; portSignature?: string; host?: string },
): TransportParams {
  switch (type) {
    case 'ble':
      return { type: 'ble', peripheralId: opts.peripheralId };
    case 'serial':
      return { type: 'serial', portSignature: opts.portSignature };
    case 'tcp':
      return { type: 'tcp', host: opts.host ?? '' };
    default: {
      const _exhaustive: never = type;
      throw new Error(`meshcoreTransportParams: unsupported transport type ${String(_exhaustive)}`);
    }
  }
}

export function bindMeshcoreIngress(
  conn: Connection,
  type: 'ble' | 'serial' | 'tcp',
  opts: { peripheralId?: string; portSignature?: string; host?: string },
  discovery?: DiscoveryInfo,
): MeshcoreIngressBind {
  const params = meshcoreTransportParams(type, opts);
  const identityId = resolveOrCreateIdentity(meshcoreProtocol, params, discovery);
  if (discovery) {
    updateIdentity(identityId, {
      signature: meshcoreProtocol.identitySignature(params, discovery),
      selfNodeNum: discovery.myNodeNum,
      publicKey: discovery.publicKey,
    });
  }
  const connectionType = type === 'tcp' ? 'http' : type;
  setConnection(identityId, { status: 'connecting', connectionType });
  setActiveIdentity(identityId);

  const teardown = meshcoreProtocol.subscribe(conn, (event) => {
    packetRouter.dispatch(event, identityId);
  });
  const detachDriver = connectionDriver.registerLegacyTransport(
    identityId,
    meshcoreProtocol,
    conn,
    type === 'tcp' ? 'tcp' : type,
    params,
    teardown,
  );

  return { identityId, detach: detachDriver };
}
