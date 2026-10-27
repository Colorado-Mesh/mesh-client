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
    const sfWireIdx = after.indexOf('registerSfHistoryWirePacket(');
    const writeIdx = after.indexOf('writeToRadioWithoutQueue(activeDevice, toRadioBytes)');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(sfWireIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeGreaterThan(registerIdx);
    expect(writeIdx).toBeGreaterThan(sfWireIdx);
  });

  it('pushes SharedContact just-in-time before CLIENT_HISTORY when the router key is known', () => {
    expect(SOURCE).toContain('buildLocalAddContactToRadioBytes({');
    expect(SOURCE).toContain('canBuildMeshtasticSharedContact(');
    const contactIdx = SOURCE.indexOf('buildLocalAddContactToRadioBytes({');
    const historyIdx = SOURCE.indexOf('buildStoreForwardHistoryToRadioBytes({');
    expect(contactIdx).toBeGreaterThan(-1);
    expect(historyIdx).toBeGreaterThan(contactIdx);
  });

  it('records SF fetch cooldown before CLIENT_HISTORY write and clears on write failure', () => {
    const historyBuildIdx = SOURCE.indexOf('buildStoreForwardHistoryToRadioBytes({');
    expect(historyBuildIdx).toBeGreaterThan(-1);
    const afterHistory = SOURCE.slice(historyBuildIdx);
    const registerIdx = afterHistory.indexOf('registerSfHistoryWirePacket(');
    const recordIdx = afterHistory.indexOf('recordSfHistoryFetch(serverNodeId, now)');
    const writeIdx = afterHistory.indexOf('writeToRadioWithoutQueue(activeDevice, toRadioBytes)');
    expect(registerIdx).toBeGreaterThan(-1);
    expect(recordIdx).toBeGreaterThan(registerIdx);
    expect(writeIdx).toBeGreaterThan(recordIdx);
    expect(afterHistory).toContain('clearSfHistoryFetch(serverNodeId)');
  });

  it('returns missing_router_key before reserving or recording a fetch (auto and manual)', () => {
    const fn = SOURCE.slice(SOURCE.indexOf('const requestStoreForwardHistory = useCallback'));
    const missing = fn.indexOf("code: 'missing_router_key'");
    const reserve = fn.indexOf('reserveStoreForwardHistoryRequest(');
    const record = fn.indexOf('recordSfHistoryFetch(serverNodeId, now)');
    expect(missing).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(missing);
    expect(record).toBeGreaterThan(missing);
    const branch = fn.slice(fn.indexOf('if (!destPublicKey)'), missing);
    expect(branch).toContain('NODEINFO_APP');
    expect(branch).not.toContain('reserveStoreForwardHistoryRequest');
    expect(branch).not.toContain('recordSfHistoryFetch');
  });

  it('sends local owner User bytes for S&F NODEINFO requests', () => {
    expect(SOURCE).toContain('ownerUserBytes');
    expect(SOURCE).toContain(
      '.sendPacket(ownerUserBytes, Portnums.PortNum.NODEINFO_APP, serverNodeId)',
    );
    expect(SOURCE).toContain('radioHasMatchingDestKey');
  });
});
