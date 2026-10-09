// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshtasticRuntime.ts');
const RELAY_CALL = 'relayMeshtasticChatToTak(storeId, mqttWithPreviews)';

describe('useMeshtasticRuntime MQTT chat TAK relay (contract)', () => {
  it('relays new MQTT chat to TAK only when it is not backlog or an already stored repeat', () => {
    const guardIdx = SOURCE.indexOf('if (!mqttTreatAsBacklog && !alreadyStored) {');
    const relayIdx = SOURCE.indexOf(RELAY_CALL);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(relayIdx).toBeGreaterThan(guardIdx);
    expect(SOURCE.indexOf(RELAY_CALL, relayIdx + 1)).toBe(-1);
  });

  it('checks repeats (including packet id 0) against stored messages before appending', () => {
    const storedIdx = SOURCE.indexOf('const alreadyStored = dedupSource.some(isSameMqttMessage);');
    const appendIdx = SOURCE.indexOf('if (prev.some(isSameMqttMessage)) return prev;');
    expect(storedIdx).toBeGreaterThan(-1);
    expect(appendIdx).toBeGreaterThan(storedIdx);
    expect(SOURCE.indexOf(RELAY_CALL)).toBeGreaterThan(appendIdx);
  });

  it('relays after the cross-transport and Store & Forward duplicate returns', () => {
    const relayIdx = SOURCE.indexOf(RELAY_CALL);
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
