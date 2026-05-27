import type { Connection } from '@liamcottle/meshcore.js';
import type { MeshDevice } from '@meshtastic/core';

import { setConnection } from '../stores/connectionStore';
import {
  addIdentity,
  findIdentityBySignature,
  setActiveIdentity,
  updateIdentity,
} from '../stores/identityStore';
import { connectionDriver } from './drivers/ConnectionDriver';
import { packetRouter } from './drivers/PacketRouter';
import { meshcoreProtocol } from './protocols/MeshCoreProtocol';
import { meshtasticProtocol } from './protocols/MeshtasticProtocol';
import type { DiscoveryInfo } from './protocols/Protocol';
import type { ConnectionType, IdentityId, TransportParams } from './types';

function randomIdentityId(prefix: string): IdentityId {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function resolveOrCreateIdentity(
  protocol: typeof meshtasticProtocol | typeof meshcoreProtocol,
  signature: string,
): IdentityId {
  const matched = findIdentityBySignature(signature);
  if (matched) return matched.id;
  const identityId = randomIdentityId(protocol.type);
  addIdentity({
    id: identityId,
    protocol,
    signature,
    transports: [],
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
  });
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
    default:
      return { type: 'http', host: '' };
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
  const signature = meshtasticProtocol.identitySignature(params, discovery);
  const identityId = resolveOrCreateIdentity(meshtasticProtocol, signature);
  if (discovery) {
    updateIdentity(identityId, {
      signature,
      selfNodeNum: discovery.myNodeNum,
      publicKey: discovery.publicKey,
    });
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
    default:
      return { type: 'tcp', host: '' };
  }
}

export function bindMeshcoreIngress(
  conn: Connection,
  type: 'ble' | 'serial' | 'tcp',
  opts: { peripheralId?: string; portSignature?: string; host?: string },
  discovery?: DiscoveryInfo,
): MeshcoreIngressBind {
  const params = meshcoreTransportParams(type, opts);
  const signature = meshcoreProtocol.identitySignature(params, discovery);
  const identityId = resolveOrCreateIdentity(meshcoreProtocol, signature);
  if (discovery) {
    updateIdentity(identityId, {
      signature,
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
