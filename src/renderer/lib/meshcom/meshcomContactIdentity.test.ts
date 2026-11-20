import { beforeEach, describe, expect, it } from 'vitest';

import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import {
  ensureOfflineProtocolIdentities,
  OFFLINE_MESHCOM_IDENTITY_ID,
} from '../offlineProtocolIdentities';
import { callsignToNodeId } from './meshcomCallsign';
import { resolveMeshcomContactIdentity } from './meshcomContactIdentity';

const CALL = 'OE1FAV-1';
const NODE_ID = callsignToNodeId(CALL);
const SESSION_ID = 'meshcom-session-fav' as const;

describe('resolveMeshcomContactIdentity', () => {
  beforeEach(() => {
    ensureOfflineProtocolIdentities();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('prefers the UI/offline bucket when the contact lives there', () => {
    upsertNodeRecord(OFFLINE_MESHCOM_IDENTITY_ID, {
      nodeId: NODE_ID,
      longName: CALL,
    });
    const hit = resolveMeshcomContactIdentity(NODE_ID, SESSION_ID);
    expect(hit.identityId).toBe(OFFLINE_MESHCOM_IDENTITY_ID);
    expect(hit.existing?.longName).toBe(CALL);
    expect(hit.mirrorIdentityId).toBeUndefined();
  });

  it('mirrors into the UI bucket when the contact only exists on the session id', () => {
    upsertNodeRecord(SESSION_ID, {
      nodeId: NODE_ID,
      longName: CALL,
    });
    const hit = resolveMeshcomContactIdentity(NODE_ID, SESSION_ID);
    expect(hit.identityId).toBe(SESSION_ID);
    expect(hit.existing?.longName).toBe(CALL);
    // UI id is offline when no connected primary — mirror so Contacts updates.
    expect(hit.mirrorIdentityId).toBe(OFFLINE_MESHCOM_IDENTITY_ID);
  });
});
