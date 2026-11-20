import { describe, expect, it } from 'vitest';

import { protocolRecord } from './appProtocolSelect';
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
});
