import { beforeEach, describe, expect, it, vi } from 'vitest';

import { meshtasticNodeNumFromPublicKeyHex } from '@/shared/meshtasticNodeNumFromPublicKey';

import { addMessage, useMessageStore } from '../../stores/messageStore';
import { upsertNodeRecord, useNodeStore } from '../../stores/nodeStore';
import {
  getMeshtasticRemoteAdminKeyForNode,
  setMeshtasticRemoteAdminKeyForNode,
} from '../meshtasticRemoteAdminKeyStorage';
import { MESHTASTIC_RENUMBER_OLD_NODE_QUIET_MS } from '../timeConstants';
import type { IdentityId } from '../types';
import {
  findRenumberedMeshtasticNode,
  migrateRenumberedMeshtasticNode,
  resetMeshtasticRenumberIndexForTests,
} from './meshtasticNodeRenumber';

const ID = 'identity-mt' as IdentityId;
const KEY = 'ab'.repeat(32);
const OLD = 0x11111111;
const NEW = meshtasticNodeNumFromPublicKeyHex(KEY)!;
const NOW = 1_800_000_000_000;
const QUIET = NOW - MESHTASTIC_RENUMBER_OLD_NODE_QUIET_MS - 1;
const ADMIN_KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe('findRenumberedMeshtasticNode', () => {
  beforeEach(() => {
    resetMeshtasticRenumberIndexForTests();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
  });

  it('returns the old number when a quiet node key reappears under a new number', () => {
    upsertNodeRecord(ID, { nodeId: OLD, publicKeyHex: KEY, lastHeardAt: QUIET });
    expect(findRenumberedMeshtasticNode(ID, NEW, KEY.toUpperCase(), NOW, NOW)).toBe(OLD);
    expect(findRenumberedMeshtasticNode(ID, NEW, KEY, NOW, NOW)).toBeNull();
  });

  it('ignores missing, zero, or mismatched keys', () => {
    upsertNodeRecord(ID, { nodeId: OLD, publicKeyHex: 'cd'.repeat(32), lastHeardAt: QUIET });
    expect(findRenumberedMeshtasticNode(ID, NEW, undefined, NOW, NOW)).toBeNull();
    expect(findRenumberedMeshtasticNode(ID, NEW, '0'.repeat(64), NOW, NOW)).toBeNull();
    expect(findRenumberedMeshtasticNode(ID, NEW, KEY, NOW, NOW)).toBeNull();
  });

  it('does not merge when the new number is not crc32 of the public key', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    upsertNodeRecord(ID, { nodeId: OLD, publicKeyHex: KEY, lastHeardAt: QUIET });
    expect(findRenumberedMeshtasticNode(ID, NEW + 1, KEY, NOW, NOW)).toBeNull();
    debug.mockRestore();
  });

  it('does not merge a cloned key that is still active on the old number', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    upsertNodeRecord(ID, { nodeId: OLD, publicKeyHex: KEY, lastHeardAt: NOW - 1000 });
    expect(findRenumberedMeshtasticNode(ID, NEW, KEY, NOW, NOW)).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never moves back to the old number on a stale NodeDB replay', () => {
    upsertNodeRecord(ID, { nodeId: NEW, publicKeyHex: KEY, lastHeardAt: QUIET });
    upsertNodeRecord(ID, { nodeId: OLD, publicKeyHex: KEY, lastHeardAt: QUIET - 10_000 });
    expect(findRenumberedMeshtasticNode(ID, OLD, KEY, QUIET - 10_000, NOW)).toBeNull();
    expect(findRenumberedMeshtasticNode(ID, NEW, KEY, NOW, NOW)).toBeNull();
  });

  it('scopes keys to one identity', () => {
    upsertNodeRecord('other', { nodeId: OLD, publicKeyHex: KEY, lastHeardAt: QUIET });
    expect(findRenumberedMeshtasticNode(ID, NEW, KEY, NOW, NOW)).toBeNull();
  });
});

describe('migrateRenumberedMeshtasticNode', () => {
  beforeEach(() => {
    localStorage.clear();
    resetMeshtasticRenumberIndexForTests();
    useNodeStore.setState({ nodes: {}, traceRoutes: {}, waypoints: {}, neighborInfo: {} });
    useMessageStore.setState({ messages: {} });
    vi.mocked(window.electronAPI.db.migrateMeshtasticNodeNum).mockReset();
  });

  it('mirrors a successful DB migration in the stores and moves the admin key', async () => {
    vi.mocked(window.electronAPI.db.migrateMeshtasticNodeNum).mockResolvedValue({
      migrated: true,
      messagesUpdated: 1,
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    upsertNodeRecord(ID, { nodeId: OLD, publicKeyHex: KEY, favorited: true });
    upsertNodeRecord(ID, { nodeId: NEW, publicKeyHex: KEY });
    addMessage(ID, { id: 'm1', from: OLD, to: 0x99, payload: 'hi', channelIndex: 0, timestamp: 1 });
    await setMeshtasticRemoteAdminKeyForNode(OLD, ADMIN_KEY);

    await expect(migrateRenumberedMeshtasticNode(ID, OLD, NEW, KEY)).resolves.toBe(true);

    expect(window.electronAPI.db.migrateMeshtasticNodeNum).toHaveBeenCalledWith(OLD, NEW, KEY);
    const nodes = useNodeStore.getState().nodes[ID];
    expect(OLD in nodes).toBe(false);
    expect(nodes[NEW].favorited).toBe(true);
    expect(useMessageStore.getState().messages[ID].m1.from).toBe(NEW);
    expect(getMeshtasticRemoteAdminKeyForNode(NEW)).toBe(ADMIN_KEY);
    expect(getMeshtasticRemoteAdminKeyForNode(OLD)).toBeUndefined();
    info.mockRestore();
  });

  it('leaves the stores alone when the DB refuses the migration', async () => {
    vi.mocked(window.electronAPI.db.migrateMeshtasticNodeNum).mockResolvedValue({
      migrated: false,
      messagesUpdated: 0,
    });
    upsertNodeRecord(ID, { nodeId: OLD, publicKeyHex: KEY });
    await expect(migrateRenumberedMeshtasticNode(ID, OLD, NEW, KEY)).resolves.toBe(false);
    expect(OLD in useNodeStore.getState().nodes[ID]).toBe(true);
  });
});
