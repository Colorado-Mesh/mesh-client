// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';

import {
  clearMeshcoreBleMacSuppression,
  commitConnectedMeshcoreBleSuppression,
  getConnectedMeshcoreBleMac,
  MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY,
  prearmMeshcoreBleMacSuppressionFromStorage,
  preserveOrClearMeshcoreBleSuppression,
  resetConnectedMeshcoreBleMacForTests,
  resolveConnectedMeshcoreBleIdentity,
  resolveConnectedMeshcoreBleMacForSuppression,
  setConnectedMeshcoreBleMac,
} from './connectedMeshcoreBleMac';
import { shouldSuppressMeshtasticNodeHear } from './meshcoreBleMacMeshtasticNodeId';

describe('resolveConnectedMeshcoreBleIdentity', () => {
  it('prefers explicit sidecar blePeripheralId over the remembered id', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: 'aa:bb:cc:dd:ee:ff',
        fallbackLastBlePeripheralId: 'stored-id',
      }),
    ).toBe('aa:bb:cc:dd:ee:ff');
  });

  it('preserves opaque CoreBluetooth peripheral UUIDs as reconnect identities', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: '  aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee  ',
        fallbackLastBlePeripheralId: 'stored-id',
      }),
    ).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('falls back to last remembered BLE id', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: '',
        fallbackLastBlePeripheralId: 'stored-mac',
      }),
    ).toBe('stored-mac');
  });

  it('returns null when no candidates are usable', () => {
    expect(
      resolveConnectedMeshcoreBleIdentity({
        blePeripheralId: '  ',
        fallbackLastBlePeripheralId: null,
      }),
    ).toBeNull();
  });
});

describe('resolveConnectedMeshcoreBleMacForSuppression', () => {
  it('skips opaque CoreBluetooth UUIDs and prefers a parseable MAC fallback', () => {
    expect(
      resolveConnectedMeshcoreBleMacForSuppression({
        blePeripheralId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        fallbackLastBlePeripheralId: 'cc:2e:e3:da:2e:2f',
      }),
    ).toBe('cc:2e:e3:da:2e:2f');
  });

  it('returns null when only opaque CoreBluetooth ids are available', () => {
    expect(
      resolveConnectedMeshcoreBleMacForSuppression({
        blePeripheralId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        fallbackLastBlePeripheralId: 'stored-opaque-uuid',
      }),
    ).toBeNull();
  });
});

describe('setConnectedMeshcoreBleMac', () => {
  afterEach(() => {
    resetConnectedMeshcoreBleMacForTests();
  });

  it('stores parseable sidecar MACs and persists them for cold-start pre-arm', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    expect(getConnectedMeshcoreBleMac()).toBe('cc:2e:e3:da:2e:2f');
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, getConnectedMeshcoreBleMac())).toBe(true);
  });

  it('clears in-memory value for opaque CoreBluetooth UUIDs without wiping sticky persistence', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    setConnectedMeshcoreBleMac('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(getConnectedMeshcoreBleMac()).toBeNull();
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, getConnectedMeshcoreBleMac())).toBe(false);
  });

  it('set(null) clears memory only; prearm restores sticky MAC before live BLE connect', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    setConnectedMeshcoreBleMac(null);
    expect(getConnectedMeshcoreBleMac()).toBeNull();
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(prearmMeshcoreBleMacSuppressionFromStorage(null)).toBe('cc:2e:e3:da:2e:2f');
    expect(getConnectedMeshcoreBleMac()).toBe('cc:2e:e3:da:2e:2f');
    expect(shouldSuppressMeshtasticNodeHear(0xe3da2e2f, getConnectedMeshcoreBleMac())).toBe(true);
  });

  it('prearm uses last-BLE fallback when persistence is empty', () => {
    expect(prearmMeshcoreBleMacSuppressionFromStorage('cc:2e:e3:da:2e:2f')).toBe(
      'cc:2e:e3:da:2e:2f',
    );
    expect(getConnectedMeshcoreBleMac()).toBe('cc:2e:e3:da:2e:2f');
  });

  it('clearMeshcoreBleMacSuppression drops memory and persistence', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    clearMeshcoreBleMacSuppression();
    expect(getConnectedMeshcoreBleMac()).toBeNull();
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBeNull();
    expect(prearmMeshcoreBleMacSuppressionFromStorage(null)).toBeNull();
  });
});

describe('preserveOrClearMeshcoreBleSuppression / commitConnectedMeshcoreBleSuppression', () => {
  afterEach(() => {
    resetConnectedMeshcoreBleMacForTests();
  });

  it('preserves sticky MAC for BLE and clears for non-BLE', () => {
    setConnectedMeshcoreBleMac('cc:2e:e3:da:2e:2f');
    preserveOrClearMeshcoreBleSuppression(true, 'cc:2e:e3:da:2e:2f');
    expect(getConnectedMeshcoreBleMac()).toBe('cc:2e:e3:da:2e:2f');
    preserveOrClearMeshcoreBleSuppression(false);
    expect(getConnectedMeshcoreBleMac()).toBeNull();
    expect(localStorage.getItem(MESHCORE_BLE_MAC_SUPPRESSION_STORAGE_KEY)).toBeNull();
  });

  it('commits a parseable MAC after successful BLE attach', () => {
    commitConnectedMeshcoreBleSuppression({
      blePeripheralId: 'aa:bb:cc:dd:ee:ff',
    });
    expect(getConnectedMeshcoreBleMac()).toBe('aa:bb:cc:dd:ee:ff');
  });
});
