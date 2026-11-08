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

vi.mock('@/renderer/lib/mecp/mecpAlertThrottle', () => ({
  recordMecpAlert: () => ({ alert: true, notify: null }),
}));

vi.mock('@/renderer/stores/incidentStore', () => ({
  useIncidentStore: {
    getState: () => ({ upsertFromMecp: vi.fn() }),
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
});
