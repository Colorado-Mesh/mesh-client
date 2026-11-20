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
  it('MeshCom does not expose a raw packet log for the Stats panel', () => {
    expect(MESHCOM_CAPABILITIES.hasRawPacketLog).toBe(false);
    expect(MESHTASTIC_CAPABILITIES.hasRawPacketLog).toBe(true);
  });
});
