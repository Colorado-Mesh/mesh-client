// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');

describe('useMeshtasticRuntime MQTT chat TAK relay (contract)', () => {
  it('relays new MQTT chat to TAK only when it is not reconnect backlog', () => {
    const relayCall =
      'if (!mqttTreatAsBacklog) relayMeshtasticChatToTak(storeId, mqttWithPreviews);';
    const relayIdx = SOURCE.indexOf(relayCall);
    expect(relayIdx).toBeGreaterThan(-1);
    expect(SOURCE.indexOf(relayCall, relayIdx + 1)).toBe(-1);
  });

  it('relays after the cross-transport and Store & Forward duplicate returns', () => {
    const relayIdx = SOURCE.indexOf('relayMeshtasticChatToTak(storeId, mqttWithPreviews)');
    const crossDupIdx = SOURCE.indexOf(
      'findMeshtasticCrossTransportDuplicate(dedupSource, mqttWithPreviews)',
    );
    const sfDupIdx = SOURCE.indexOf(
      'findMeshtasticStoreForwardDuplicate(dedupSource, mqttWithPreviews)',
    );
    expect(crossDupIdx).toBeGreaterThan(-1);
    expect(sfDupIdx).toBeGreaterThan(-1);
    expect(relayIdx).toBeGreaterThan(crossDupIdx);
    expect(relayIdx).toBeGreaterThan(sfDupIdx);
  });
});
