// @vitest-environment jsdom
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWindowsBlePairState,
  isWindowsPinRejected,
  pairWindowsBle,
  shouldOfferWindowsRePair,
  unpairWindowsBle,
  WindowsBlePairingError,
  windowsPairingFailureMessage,
} from './windowsBlePairing';

describe('windowsBlePairing', () => {
  beforeEach(() => {
    vi.spyOn(console, 'debug').mockImplementation(() => {});
    window.electronAPI = {
      ...window.electronAPI,
      gattPairState: vi.fn(),
      gattPair: vi.fn(),
      gattUnpair: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('maps pair state results', async () => {
    const pairState = vi.mocked(window.electronAPI.gattPairState);
    pairState.mockResolvedValueOnce({ ok: true, paired: true });
    await expect(getWindowsBlePairState('ef:4f:4f:1c:23:73')).resolves.toBe('paired');
    pairState.mockResolvedValueOnce({ ok: true, paired: false });
    await expect(getWindowsBlePairState('ef:4f:4f:1c:23:73')).resolves.toBe('unpaired');
    pairState.mockResolvedValueOnce({ ok: false, code: 'unsupported', error: 'x' });
    await expect(getWindowsBlePairState('ef:4f:4f:1c:23:73')).resolves.toBe('unknown');
    pairState.mockRejectedValueOnce(new Error('sidecar down'));
    await expect(getWindowsBlePairState('ef:4f:4f:1c:23:73')).resolves.toBe('unknown');
    pairState.mockResolvedValueOnce({
      ok: false,
      code: 'internal',
      error: 'fetch failed',
    });
    await expect(getWindowsBlePairState('ef:4f:4f:1c:23:73')).resolves.toBe('unknown');
  });

  it.each([
    ['connect_timeout', 'pair state timed out'],
    ['connect_timeout', 'windows pair-state timed out'],
    ['connect_timeout', 'Windows could not find the radio (timeout)'],
    ['internal', 'windows IsPaired: The device is unreachable'],
    ['internal', 'windows pair-state task failed: join error'],
  ])('blocks connect when pair state fails with %s (%s)', async (code, error) => {
    vi.mocked(window.electronAPI.gattPairState).mockResolvedValueOnce({
      ok: false,
      code,
      error,
    });
    await expect(getWindowsBlePairState('ef:4f:4f:1c:23:73')).resolves.toBe('blocked');
  });

  it('maps Gatt pairing codes to locale keys and leaves sidecar English out', () => {
    const t = ((key: string) => key) as TFunction;
    const sidecarEnglish = 'Windows pairing failed (status=NotReadyToPair)';
    expect(
      windowsPairingFailureMessage(
        new WindowsBlePairingError('pairing_required', sidecarEnglish),
        t,
      ),
    ).toBe('connectionPanel.errors.ble.pairing_required');
    expect(
      windowsPairingFailureMessage(
        new WindowsBlePairingError(
          'authentication_failed',
          'Windows rejected the pairing PIN (status=AuthenticationFailure)',
        ),
        t,
      ),
    ).toBe('connectionPanel.error.windowsPinRejected');
    expect(
      windowsPairingFailureMessage(
        new WindowsBlePairingError('connect_timeout', 'windows pair timed out'),
        t,
      ),
    ).toBe('connectionPanel.errors.ble.connect_timeout');
    expect(
      windowsPairingFailureMessage(
        new WindowsBlePairingError('internal', 'windows IsPaired: exploded'),
        t,
      ),
    ).toBe('connectionPanel.stagePairingFailed');
    expect(
      windowsPairingFailureMessage(
        new WindowsBlePairingError('unsupported', 'only implemented on Windows'),
        t,
      ),
    ).toBe('connectionPanel.error.windowsPairingUnsupported');
    expect(
      windowsPairingFailureMessage(
        new WindowsBlePairingError('invalid_address', 'pairing PIN must be 4 to 6 digits'),
        t,
      ),
    ).toBe('connectionPanel.error.windowsPairingInvalidAddress');
    expect(
      windowsPairingFailureMessage(new WindowsBlePairingError('invalid_profile', 'bad profile'), t),
    ).toBe('connectionPanel.error.windowsPairingInvalidProfile');
    expect(
      windowsPairingFailureMessage(new WindowsBlePairingError('mac_conflict', 'held'), t),
    ).toBe('connectionPanel.errors.ble.mac_conflict');
  });

  it('throws coded errors for pair / unpair failures', async () => {
    vi.mocked(window.electronAPI.gattPair).mockResolvedValueOnce({
      ok: false,
      code: 'authentication_failed',
      error: 'Windows rejected the pairing PIN',
    });
    const err = await pairWindowsBle('ef:4f:4f:1c:23:73', '000000').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(WindowsBlePairingError);
    expect(isWindowsPinRejected(err)).toBe(true);
    expect((err as Error).message).toBe('authentication_failed: Windows rejected the pairing PIN');

    vi.mocked(window.electronAPI.gattUnpair).mockResolvedValueOnce({
      ok: false,
      code: 'mac_conflict',
      error: 'disconnect first',
    });
    const unpairErr = await unpairWindowsBle('ef:4f:4f:1c:23:73').catch((e: unknown) => e);
    expect(isWindowsPinRejected(unpairErr)).toBe(false);
    expect((unpairErr as WindowsBlePairingError).code).toBe('mac_conflict');
  });

  it.each([
    [new Error('pairing_required: subscribe: Access is denied.'), true],
    [{ code: 'pairing_required', message: 'need pin' }, true],
    [new Error('connect_timeout: connect timed out: Bluetooth stack unresponsive'), true],
    [{ code: 'adapter_missing', message: 'scan refused: Bluetooth stack unresponsive' }, true],
    ['Bluetooth stack unresponsive', true],
    [new Error('connect_timeout: peripheral lookup timed out'), false],
    [new Error('gatt_discover_failed: service discovery timed out'), false],
  ])('shouldOfferWindowsRePair(%o) = %s', (err, expected) => {
    expect(shouldOfferWindowsRePair(err)).toBe(expected);
  });
});
