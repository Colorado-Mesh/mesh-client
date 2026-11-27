import { describe, expect, it } from 'vitest';

import { protocolRecord, selectByProtocol } from './appProtocolSelect';
import {
  MESHCOM_CAPABILITIES,
  MESHCORE_CAPABILITIES,
  MESHTASTIC_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from './radio/BaseRadioProvider';

describe('protocolRecord', () => {
  it('does not copy Reticulum into meshcom when the fourth arg is omitted', () => {
    const caps = protocolRecord(
      MESHTASTIC_CAPABILITIES,
      MESHCORE_CAPABILITIES,
      RETICULUM_CAPABILITIES,
    );
    expect(caps.meshcom).toBe(MESHCORE_CAPABILITIES);
    expect(caps.meshcom.hasRrcPanel).toBe(false);
    expect(caps.reticulum.hasRrcPanel).toBe(true);
  });

  it('keeps an explicit MeshCom capabilities entry', () => {
    const caps = protocolRecord(
      MESHTASTIC_CAPABILITIES,
      MESHCORE_CAPABILITIES,
      RETICULUM_CAPABILITIES,
      MESHCOM_CAPABILITIES,
    );
    expect(caps.meshcom).toBe(MESHCOM_CAPABILITIES);
    expect(caps.meshcom.protocol).toBe('meshcom');
  });

  it('friends identity map selects MeshCom identity, not Reticulum', () => {
    const friendsIdentityByProtocol = protocolRecord('id-mt', 'id-mc', 'id-rns', 'id-cm');
    expect(selectByProtocol(friendsIdentityByProtocol, 'meshcom')).toBe('id-cm');
    expect(selectByProtocol(friendsIdentityByProtocol, 'reticulum')).toBe('id-rns');
  });
});

describe('Stats / raw packet gating', () => {
  it('MeshCom exposes a raw packet log for Stats and Sniffer', () => {
    expect(MESHCOM_CAPABILITIES.hasRawPacketLog).toBe(true);
    expect(MESHTASTIC_CAPABILITIES.hasRawPacketLog).toBe(true);
  });
});

describe('RF histograms gating', () => {
  it('MeshCom enables the RF tab via hasRfStats', () => {
    expect(MESHCOM_CAPABILITIES.hasRfStats).toBe(true);
    expect(RETICULUM_CAPABILITIES.hasRfStats).toBe(false);
  });
});
