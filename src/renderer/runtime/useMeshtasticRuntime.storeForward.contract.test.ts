// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');

describe('useMeshtasticRuntime Store & Forward history request (contract)', () => {
  it('registers the CLIENT_HISTORY wire id as non-chat before writing it', () => {
    const buildIdx = SOURCE.indexOf('buildStoreForwardHistoryToRadioBytes({');
    expect(buildIdx).toBeGreaterThan(-1);
    const after = SOURCE.slice(buildIdx);
    const registerIdx = after.indexOf('registerMeshtasticNonChatWirePacketId(packetId)');
    const writeIdx = after.indexOf('writeToRadioWithoutQueue(activeDevice, toRadioBytes)');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(registerIdx);
  });
});
