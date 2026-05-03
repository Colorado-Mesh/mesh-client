/**
 * Regression test for GitHub #272: connected meshtastic node showing offline.
 *
 * Root cause: when the self node is first seen via onMyNodeInfo, emptyNode()
 * initialises last_heard to 0.  Meshtastic devices do not report their own
 * lastHeard in NodeInfo packets (it would always be 0), so onNodeInfoPacket
 * used to keep the 0 value, causing getNodeStatus to return 'offline'.
 *
 * Fix: onMyNodeInfo sets last_heard = Date.now() for a brand-new self node,
 * and onNodeInfoPacket falls back to Date.now() for the self node when both
 * info.lastHeard and existing.last_heard are 0.
 */
import { describe, expect, it } from 'vitest';

import { getNodeStatus } from '../lib/nodeStatus';
import {
  computeNodeInfoLastHeardMs,
  emptyNode,
  mergeMeshtasticUserPacketLastHeard,
} from './useDevice';

const MY_NODE_NUM = 0xdeadbeef;

describe('self-node last_heard initialisation (#272)', () => {
  it('emptyNode starts with last_heard=0 (confirming the raw default)', () => {
    const node = emptyNode(MY_NODE_NUM);
    expect(node.last_heard).toBe(0);
  });

  it('a node with last_heard=0 is reported as offline', () => {
    const status = getNodeStatus(0);
    expect(status).toBe('offline');
  });

  it('a self node whose last_heard is set to Date.now() is reported as online', () => {
    // Simulates the initialisation that onMyNodeInfo now performs.
    const selfNode = { ...emptyNode(MY_NODE_NUM), hops_away: 0, last_heard: Date.now() };
    const status = getNodeStatus(selfNode.last_heard);
    expect(status).toBe('online');
  });

  it('fallback to Date.now() for self when info.lastHeard and existing.last_heard are both 0', () => {
    // Simulates the onNodeInfoPacket fallback for the self node.
    const lastHeardMs = computeNodeInfoLastHeardMs(0, 0, true);
    expect(getNodeStatus(lastHeardMs)).toBe('online');
  });

  it('non-self node with info.lastHeard=0 and existing=0 stays offline', () => {
    const lastHeardMs = computeNodeInfoLastHeardMs(0, 0, false);
    expect(getNodeStatus(lastHeardMs)).toBe('offline');
  });
});

describe('mergeMeshtasticUserPacketLastHeard', () => {
  it('does not bump during configure replay', () => {
    expect(mergeMeshtasticUserPacketLastHeard(0, Date.now(), true)).toBe(0);
    expect(mergeMeshtasticUserPacketLastHeard(1_000_000, Date.now(), true)).toBe(1_000_000);
  });

  it('ignores invalid rx times', () => {
    expect(mergeMeshtasticUserPacketLastHeard(1000, 0, false)).toBe(1000);
    expect(mergeMeshtasticUserPacketLastHeard(1000, NaN, false)).toBe(1000);
  });

  it('takes max of existing and packet rx when post-configure', () => {
    const rx = 5_000_000;
    expect(mergeMeshtasticUserPacketLastHeard(0, rx, false)).toBe(rx);
    expect(mergeMeshtasticUserPacketLastHeard(10_000_000, rx, false)).toBe(10_000_000);
    expect(mergeMeshtasticUserPacketLastHeard(1000, rx, false)).toBe(rx);
  });
});
