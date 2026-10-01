// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getWindowsBlePairState,
  isWindowsPinRejected,
  pairWindowsBle,
  shouldOfferWindowsRePair,
  unpairWindowsBle,
  WindowsBlePairingError,
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
