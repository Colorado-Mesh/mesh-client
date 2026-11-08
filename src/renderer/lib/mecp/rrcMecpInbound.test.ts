import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearMecpRebroadcastFingerprintsForTests } from './mecpRebroadcast';
import { clearRrcMecpInboundSeenForTests, handleRrcMecpInbound } from './rrcMecpInbound';

vi.mock('@/renderer/lib/appSettingsStorage', () => ({
  getAppSettingsRaw: () =>
    JSON.stringify({
      mecpRebroadcastRules: [
        {
          id: 'rrc-to-mt',
          enabled: true,
          bidirectional: false,
          endpointA: {
            protocol: 'reticulum',
            kind: 'rrc',
            hubDestHash: '0123456789abcdef0123456789abcdef',
            room: '#emcomm',
          },
          endpointB: { protocol: 'meshtastic', channelIndex: 1 },
        },
      ],
    }),
}));

vi.mock('@/renderer/lib/mecp/sendMecpRebroadcast', () => ({
  resolveMecpSourceChannelName: () => '01234567/#emcomm',
  sendMecpRebroadcastOnProtocol: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/renderer/lib/mecp/mecpAlert', () => ({
  triggerMecpAlert: vi.fn(),
  notifyMecpAlertsSuppressed: vi.fn(),
}));

const recordMecpAlertMock = vi.fn().mockReturnValue({ alert: true, notify: null });
vi.mock('@/renderer/lib/mecp/mecpAlertThrottle', () => ({
  recordMecpAlert: (key: string) => recordMecpAlertMock(key) as { alert: boolean; notify: null },
}));

const upsertFromMecpMock = vi.fn();
vi.mock('@/renderer/stores/incidentStore', () => ({
  useIncidentStore: {
    getState: () => ({ upsertFromMecp: upsertFromMecpMock }),
  },
}));

vi.mock('@/renderer/stores/mecpBlockStore', () => ({
  isMecpSenderBlocked: () => false,
  mecpBlockKey: (p: string, id: string) => `${p}:${id}`,
  useMecpBlockStore: { getState: () => ({ block: vi.fn() }) },
}));

vi.mock('@/renderer/lib/chatPanelProtocolStorage', () => ({
  loadMutedViews: () => new Set(),
}));

import { sendMecpRebroadcastOnProtocol } from './sendMecpRebroadcast';

const HUB = '0123456789abcdef0123456789abcdef';

describe('handleRrcMecpInbound', () => {
  beforeEach(() => {
    clearRrcMecpInboundSeenForTests();
    clearMecpRebroadcastFingerprintsForTests();
    vi.mocked(sendMecpRebroadcastOnProtocol).mockClear();
    recordMecpAlertMock.mockClear();
    upsertFromMecpMock.mockClear();
    vi.stubGlobal('window', {
      electronAPI: {
        mecp: {
          appendReceived: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    });
  });

  it('rebroadcasts MECP from an RRC room to Meshtastic', async () => {
    await handleRrcMecpInbound({
      messageId: 'm1',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: 'aabbccddeeff0011aabbccddeeff0011',
      nickname: 'Ada',
      localIdentityHash: '11112222333344445555666677778888',
    });
    expect(sendMecpRebroadcastOnProtocol).toHaveBeenCalled();
    const first = vi.mocked(sendMecpRebroadcastOnProtocol).mock.calls[0];
    expect(first).toBeDefined();
    expect(first[0]).toMatchObject({ protocol: 'meshtastic', channelIndex: 1 });
    expect(first[1]).toBe('MECP/0/M01');
  });

  it('skips non-MECP bodies', async () => {
    await handleRrcMecpInbound({
      messageId: 'm2',
      body: 'hello room',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: 'aabbccddeeff0011aabbccddeeff0011',
      nickname: null,
      localIdentityHash: null,
    });
    expect(sendMecpRebroadcastOnProtocol).not.toHaveBeenCalled();
  });

  it('skips own identity', async () => {
    const self = 'aabbccddeeff0011aabbccddeeff0011';
    await handleRrcMecpInbound({
      messageId: 'm3',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: self,
      nickname: 'Me',
      localIdentityHash: self,
    });
    expect(sendMecpRebroadcastOnProtocol).not.toHaveBeenCalled();
  });

  it('skips a hashless echo of our nickname before incident or rebroadcast', async () => {
    await handleRrcMecpInbound({
      messageId: 'm-own-nick',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: null,
      nickname: 'MeshOp',
      localIdentityHash: '11112222333344445555666677778888',
      localNickname: 'MeshOp',
    });
    expect(sendMecpRebroadcastOnProtocol).not.toHaveBeenCalled();
    expect(upsertFromMecpMock).not.toHaveBeenCalled();
    expect(recordMecpAlertMock).not.toHaveBeenCalled();
  });

  it('does not treat a different hash as own just because the nickname matches', async () => {
    await handleRrcMecpInbound({
      messageId: 'm-spoof-nick',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      nickname: 'MeshOp',
      localIdentityHash: '11112222333344445555666677778888',
      localNickname: 'MeshOp',
    });
    expect(sendMecpRebroadcastOnProtocol).toHaveBeenCalled();
    expect(recordMecpAlertMock).toHaveBeenCalledWith('reticulum:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  it('gives hashless strangers separate throttle buckets', async () => {
    await handleRrcMecpInbound({
      messageId: 'm-ada',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: null,
      nickname: 'Ada',
      localIdentityHash: '11112222333344445555666677778888',
      localNickname: 'MeshOp',
    });
    await handleRrcMecpInbound({
      messageId: 'm-bob',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: null,
      nickname: 'Bob',
      localIdentityHash: '11112222333344445555666677778888',
      localNickname: 'MeshOp',
    });
    await handleRrcMecpInbound({
      messageId: 'm-anon-1',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: null,
      nickname: null,
      localIdentityHash: '11112222333344445555666677778888',
      localNickname: 'MeshOp',
    });
    await handleRrcMecpInbound({
      messageId: 'm-anon-2',
      body: 'MECP/0/M01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: '  ',
      nickname: '  ',
      localIdentityHash: '11112222333344445555666677778888',
      localNickname: 'MeshOp',
    });
    expect(recordMecpAlertMock.mock.calls.map((call) => call[0])).toEqual([
      'reticulum:nick:ada',
      'reticulum:nick:bob',
      'reticulum:anon:m-anon-1',
      'reticulum:anon:m-anon-2',
    ]);
    expect(upsertFromMecpMock).toHaveBeenCalledTimes(4);
  });

  it('audits drills without rebroadcast or throttle', async () => {
    await handleRrcMecpInbound({
      messageId: 'm-drill',
      body: 'MECP/0/D01',
      room: '#emcomm',
      hubDestHash: HUB,
      senderHash: 'aabbccddeeff0011aabbccddeeff0011',
      nickname: 'Ada',
      localIdentityHash: '11112222333344445555666677778888',
    });
    expect(recordMecpAlertMock).not.toHaveBeenCalled();
    expect(upsertFromMecpMock).toHaveBeenCalled();
    expect(window.electronAPI.mecp.appendReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        drill: true,
        direction: 'received',
        messageId: 'm-drill',
      }),
    );
    expect(sendMecpRebroadcastOnProtocol).not.toHaveBeenCalled();
  });
});
