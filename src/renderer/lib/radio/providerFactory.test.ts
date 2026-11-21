import { describe, expect, it } from 'vitest';

import { MESHCOM_CAPABILITIES } from './BaseRadioProvider';
import { getRadioCapabilities } from './providerFactory';

describe('getRadioCapabilities', () => {
  it('returns MeshCom capabilities before the protocol module is registered', () => {
    expect(getRadioCapabilities('meshcom')).toBe(MESHCOM_CAPABILITIES);
    expect(getRadioCapabilities('meshcom').hasRrcPanel).toBe(false);
    expect(getRadioCapabilities('meshcom').hasNomadNetworkPanel).toBe(false);
  });
});
