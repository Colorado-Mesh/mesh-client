import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearReticulumHashRegistry,
  registerReticulumDestinationHash,
  reticulumHashToNodeId,
} from '@/renderer/lib/reticulum/destHash';
import {
  canonicalizeReticulumChatDmNodeId,
  findLxmfDeliveryHashForIdentity,
  isReticulumTelephonyOnlyDestination,
  LXMF_DELIVERY_ASPECT,
  remapReticulumChatDmTabNodeId,
  resolveReticulumChatLxmfDestination,
  reticulumChatDmNodeIdsEquivalent,
} from '@/renderer/lib/reticulum/resolveReticulumChatLxmfDest';
import { LXST_TELEPHONY_ASPECT } from '@/renderer/lib/reticulumVoiceCapability';
import { useReticulumIdentityActivityStore } from '@/renderer/stores/reticulumIdentityActivityStore';
import { useReticulumPeerStore } from '@/renderer/stores/reticulumPeerStore';

const IDENTITY = '0f79468863d76b3ba574baa92606ffcb';
const LXMF = 'e3359f1314aff4fb6261400a8202149b';
const TELEPHONY = 'ab1d53d6923d6983dfb4451e3869b878';

describe('resolveReticulumChatLxmfDestination', () => {
  beforeEach(() => {
    clearReticulumHashRegistry();
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map(),
      history: new Map(),
    });
  });

  it('keeps an lxmf.delivery destination', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 100,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumChatLxmfDestination(LXMF)).toEqual({
      status: 'ok',
      hash: LXMF,
      remapped: false,
    });
  });

  it('remaps lxst.telephony to the identity lxmf.delivery hash', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          TELEPHONY,
          [
            {
              destination_hash: TELEPHONY,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 200,
            },
          ],
        ],
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 150,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumChatLxmfDestination(TELEPHONY)).toEqual({
      status: 'ok',
      hash: LXMF,
      remapped: true,
    });
  });

  it('returns missing_lxmf for telephony without a known lxmf.delivery', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          TELEPHONY,
          [
            {
              destination_hash: TELEPHONY,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 200,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumChatLxmfDestination(TELEPHONY)).toEqual({ status: 'missing_lxmf' });
  });

  it('allows unknown path-table hashes with no aspect activity', () => {
    expect(resolveReticulumChatLxmfDestination(LXMF)).toEqual({
      status: 'ok',
      hash: LXMF,
      remapped: false,
    });
  });

  it('remaps a known RNS identity hash to lxmf.delivery', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 150,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumChatLxmfDestination(IDENTITY)).toEqual({
      status: 'ok',
      hash: LXMF,
      remapped: true,
    });
  });

  it('returns missing_lxmf for a known identity without lxmf.delivery', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          TELEPHONY,
          [
            {
              destination_hash: TELEPHONY,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 200,
            },
          ],
        ],
      ]),
    });
    expect(resolveReticulumChatLxmfDestination(IDENTITY)).toEqual({ status: 'missing_lxmf' });
  });

  it('remaps identity via peer.identity_hash when activity dest rows are empty for the paste', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 150,
            },
          ],
        ],
      ]),
    });
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          LXMF,
          {
            destination_hash: LXMF,
            display_name: 'Peer',
            identity_hash: IDENTITY,
            hops: null,
            last_seen: 1,
            is_contact: false,
          },
        ],
      ]),
      contacts: new Map(),
      history: new Map(),
    });
    expect(resolveReticulumChatLxmfDestination(IDENTITY)).toEqual({
      status: 'ok',
      hash: LXMF,
      remapped: true,
    });
  });

  it('rejects invalid hashes', () => {
    expect(resolveReticulumChatLxmfDestination('not-a-hash')).toEqual({ status: 'invalid' });
  });

  it('findLxmfDeliveryHashForIdentity picks newest lxmf.delivery row', () => {
    const older = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const map = new Map([
      [
        older,
        [
          {
            destination_hash: older,
            aspect: LXMF_DELIVERY_ASPECT,
            identity_hash: IDENTITY,
            last_seen: 10,
          },
        ],
      ],
      [
        LXMF,
        [
          {
            destination_hash: LXMF,
            aspect: LXMF_DELIVERY_ASPECT,
            identity_hash: IDENTITY,
            last_seen: 99,
          },
        ],
      ],
    ]);
    expect(findLxmfDeliveryHashForIdentity(IDENTITY, map)).toBe(LXMF);
  });

  it('isReticulumTelephonyOnlyDestination detects telephony-only rows', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          TELEPHONY,
          [
            {
              destination_hash: TELEPHONY,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 1,
            },
          ],
        ],
      ]),
    });
    expect(isReticulumTelephonyOnlyDestination(TELEPHONY)).toBe(true);
    expect(isReticulumTelephonyOnlyDestination(LXMF)).toBe(false);
  });

  it('remaps telephony via peerIdentityHint when activity row lacks identity_hash', () => {
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          TELEPHONY,
          [
            {
              destination_hash: TELEPHONY,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: '',
              last_seen: 200,
            },
          ],
        ],
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 150,
            },
          ],
        ],
      ]),
    });
    useReticulumPeerStore.setState({
      peers: new Map([
        [
          TELEPHONY,
          {
            destination_hash: TELEPHONY,
            display_name: 'Voice peer',
            identity_hash: IDENTITY,
            hops: 1,
            last_seen: 1,
            is_contact: false,
          },
        ],
      ]),
      contacts: new Map(),
      history: new Map(),
    });
    expect(resolveReticulumChatLxmfDestination(TELEPHONY)).toEqual({
      status: 'ok',
      hash: LXMF,
      remapped: true,
    });
  });
});

describe('canonicalizeReticulumChatDmNodeId', () => {
  beforeEach(() => {
    clearReticulumHashRegistry();
    useReticulumIdentityActivityStore.setState({ byDestination: new Map() });
    useReticulumPeerStore.setState({
      peers: new Map(),
      contacts: new Map(),
      history: new Map(),
    });
  });

  it('canonicalizes an identity-bound node id to the LXMF fold', () => {
    const identityId = reticulumHashToNodeId(IDENTITY) >>> 0;
    const lxmfId = reticulumHashToNodeId(LXMF) >>> 0;
    registerReticulumDestinationHash(identityId, IDENTITY);
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 150,
            },
          ],
        ],
      ]),
    });
    expect(canonicalizeReticulumChatDmNodeId(identityId)).toBe(lxmfId);
    expect(remapReticulumChatDmTabNodeId(identityId)).toBe(lxmfId);
    expect(reticulumChatDmNodeIdsEquivalent(identityId, lxmfId)).toBe(true);
  });

  it('canonicalizes a telephony-bound node id to the LXMF fold', () => {
    const telephonyId = reticulumHashToNodeId(TELEPHONY) >>> 0;
    const lxmfId = reticulumHashToNodeId(LXMF) >>> 0;
    registerReticulumDestinationHash(telephonyId, TELEPHONY);
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          TELEPHONY,
          [
            {
              destination_hash: TELEPHONY,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 200,
            },
          ],
        ],
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 150,
            },
          ],
        ],
      ]),
    });
    expect(canonicalizeReticulumChatDmNodeId(telephonyId)).toBe(lxmfId);
    expect(remapReticulumChatDmTabNodeId(telephonyId)).toBe(lxmfId);
    expect(reticulumChatDmNodeIdsEquivalent(telephonyId, lxmfId)).toBe(true);
  });

  it('leaves sticky LXMF tab ids unchanged when the hash fold differs', () => {
    const stickyId = 0x201;
    registerReticulumDestinationHash(stickyId, LXMF);
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 100,
            },
          ],
        ],
      ]),
    });
    const lxmfFold = reticulumHashToNodeId(LXMF) >>> 0;
    expect(remapReticulumChatDmTabNodeId(stickyId)).toBe(stickyId);
    expect(canonicalizeReticulumChatDmNodeId(stickyId)).toBe(lxmfFold);
    expect(reticulumChatDmNodeIdsEquivalent(stickyId, lxmfFold)).toBe(true);
  });

  it('leaves an LXMF-bound node id unchanged', () => {
    const lxmfId = reticulumHashToNodeId(LXMF) >>> 0;
    registerReticulumDestinationHash(lxmfId, LXMF);
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          LXMF,
          [
            {
              destination_hash: LXMF,
              aspect: LXMF_DELIVERY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 100,
            },
          ],
        ],
      ]),
    });
    expect(canonicalizeReticulumChatDmNodeId(lxmfId)).toBe(lxmfId);
  });

  it('leaves telephony-only missing_lxmf ids unchanged and non-equivalent to LXMF', () => {
    const telephonyId = reticulumHashToNodeId(TELEPHONY) >>> 0;
    const lxmfId = reticulumHashToNodeId(LXMF) >>> 0;
    registerReticulumDestinationHash(telephonyId, TELEPHONY);
    useReticulumIdentityActivityStore.setState({
      byDestination: new Map([
        [
          TELEPHONY,
          [
            {
              destination_hash: TELEPHONY,
              aspect: LXST_TELEPHONY_ASPECT,
              identity_hash: IDENTITY,
              last_seen: 200,
            },
          ],
        ],
      ]),
    });
    expect(canonicalizeReticulumChatDmNodeId(telephonyId)).toBe(telephonyId);
    expect(reticulumChatDmNodeIdsEquivalent(telephonyId, lxmfId)).toBe(false);
  });

  it('leaves ids with no registry hash unchanged', () => {
    expect(canonicalizeReticulumChatDmNodeId(42_001)).toBe(42_001);
    expect(reticulumChatDmNodeIdsEquivalent(42_001, 42_002)).toBe(false);
  });
});
