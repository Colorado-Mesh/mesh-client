import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MecpRebroadcastSendTarget } from './mecpRebroadcast';
import {
  resolveMecpSourceChannelName,
  sendMecpRebroadcastOnProtocol,
  sendMecpRebroadcastToReticulum,
} from './sendMecpRebroadcast';

const HUB = 'a'.repeat(32);
const PEER = 'b'.repeat(32);

const getStatus = vi.fn();
const rrcSend = vi.fn();
const proxyPost = vi.fn();

describe('sendMecpRebroadcast → Reticulum', () => {
  beforeEach(() => {
    getStatus.mockReset().mockResolvedValue({ running: true });
    rrcSend.mockReset().mockResolvedValue({ ok: true });
    proxyPost.mockReset().mockResolvedValue({ ok: true });
    vi.stubGlobal('window', {
      electronAPI: { reticulum: { getStatus, proxyPost, rrc: { send: rrcSend } } },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends to an RRC room as a normal message', async () => {
    await sendMecpRebroadcastToReticulum(
      { protocol: 'reticulum', kind: 'rrc', hubDestHash: HUB, room: '#emcomm' },
      'MECP/0/M01',
    );
    expect(rrcSend).toHaveBeenCalledWith({
      hub_dest_hash: HUB,
      room: '#emcomm',
      body: 'MECP/0/M01',
      type: 'msg',
    });
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('sends an LXMF DM with `text` (sidecar contract)', async () => {
    await sendMecpRebroadcastToReticulum(
      { protocol: 'reticulum', kind: 'lxmf', destinationHash: PEER },
      'MECP/0/M01',
    );
    expect(proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/send', {
      destination_hash: PEER,
      text: 'MECP/0/M01',
    });
  });

  it('refuses to send while the Reticulum stack is not running or unhealthy', async () => {
    getStatus.mockResolvedValue({ running: false });
    await expect(
      sendMecpRebroadcastToReticulum(
        { protocol: 'reticulum', kind: 'lxmf', destinationHash: PEER },
        'x',
      ),
    ).rejects.toThrow('not running');
    getStatus.mockResolvedValue({ running: true, healthy: false });
    await expect(
      sendMecpRebroadcastToReticulum(
        { protocol: 'reticulum', kind: 'rrc', hubDestHash: HUB, room: 'r' },
        'x',
      ),
    ).rejects.toThrow('not running');
    expect(rrcSend).not.toHaveBeenCalled();
    expect(proxyPost).not.toHaveBeenCalled();
  });

  it('propagates RRC / LXMF rejections', async () => {
    rrcSend.mockResolvedValue({ ok: false, error: 'not_joined' });
    await expect(
      sendMecpRebroadcastToReticulum(
        { protocol: 'reticulum', kind: 'rrc', hubDestHash: HUB, room: 'r' },
        'x',
      ),
    ).rejects.toThrow('not_joined');
    proxyPost.mockResolvedValue({ ok: false, error: 'no_path' });
    await expect(
      sendMecpRebroadcastToReticulum(
        { protocol: 'reticulum', kind: 'lxmf', destinationHash: PEER },
        'x',
      ),
    ).rejects.toThrow('no_path');
  });

  it('dispatches Reticulum targets from the default send fn and rejects malformed ones', async () => {
    const target: MecpRebroadcastSendTarget = {
      protocol: 'reticulum',
      channelIndex: 0,
      reticulum: { protocol: 'reticulum', kind: 'lxmf', destinationHash: PEER },
      ruleId: 'r',
      bidirectional: false,
      fromProtocol: 'meshtastic',
      fromChannel: 0,
    };
    await sendMecpRebroadcastOnProtocol(target, 'MECP/0/M01');
    expect(proxyPost).toHaveBeenCalledOnce();
    await expect(
      sendMecpRebroadcastOnProtocol({ ...target, reticulum: undefined }, 'x'),
    ).rejects.toThrow('missing');
  });

  it('names Reticulum sources by transport instead of a channel', () => {
    expect(resolveMecpSourceChannelName('reticulum', 0)).toBe('LXMF');
  });
});
