// @vitest-environment jsdom
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_SETUP_ABORT_MESSAGE } from './bleConnectErrors';
import {
  hostFromAddressInput,
  humanizeBleError,
  humanizeHttpError,
  humanizeSerialError,
  isMeshtasticLocalAddress,
} from './connectionPanelErrorHumanize';

function mockT(): TFunction {
  return ((key: string, opts?: Record<string, unknown>) => {
    if (key === 'connectionPanel.humanize.prefixedHint' && opts) {
      return `${opts.message as string} — ${opts.hint as string}`;
    }
    if (opts?.message) {
      return `${key}:${opts.message as string}`;
    }
    return key;
  }) as TFunction;
}

function setUserAgent(ua: string): void {
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(ua);
}

const UA = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
  darwin: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/537.36',
};

describe('hostFromAddressInput / isMeshtasticLocalAddress', () => {
  it('parses host from bare IP and mdns hostname', () => {
    expect(hostFromAddressInput('192.168.1.10')).toBe('192.168.1.10');
    expect(hostFromAddressInput('http://meshtastic.local')).toBe('meshtastic.local');
    expect(isMeshtasticLocalAddress('meshtastic.local')).toBe(true);
    expect(isMeshtasticLocalAddress('node.meshtastic.local')).toBe(true);
    expect(isMeshtasticLocalAddress('192.168.1.10')).toBe(false);
  });
});

describe('humanizeSerialError', () => {
  const t = mockT();

  it.each([
    ['windows', UA.windows, 'access denied', 'accessDeniedWindowsHint'],
    ['linux', UA.linux, 'permission denied', 'accessDeniedLinuxHint'],
    ['any', UA.linux, 'device not found', 'disconnectedHint'],
    ['any', UA.linux, 'connection timed out', 'timeoutHint'],
    ['any', UA.linux, 'port is already open', 'portStillOpenHint'],
  ] as const)('maps %s serial error "%s"', (_label, ua, message, hintKey) => {
    setUserAgent(ua);
    const result = humanizeSerialError(new Error(message), t);
    expect(result).toContain(message);
    expect(result).toContain(`connectionPanel.humanize.serial.${hintKey}`);
  });

  it('returns raw message when no pattern matches', () => {
    setUserAgent(UA.linux);
    expect(humanizeSerialError(new Error('unknown serial fault'), t)).toBe('unknown serial fault');
  });
});

describe('humanizeHttpError', () => {
  const t = mockT();

  it.each([
    [
      'mdns windows timeout',
      UA.windows,
      'meshtastic.local',
      'request timed out',
      'timeoutMdnsWindows',
    ],
    ['mdns non-windows timeout', UA.linux, 'meshtastic.local', 'timeout', 'timeoutMdnsNonWindows'],
    ['ip timeout', UA.linux, '192.168.1.10', 'aborted', 'timeoutGeneric'],
    ['unauthorized', UA.linux, '192.168.1.10', '401 unauthorized', 'unauthorizedHint'],
    ['refused', UA.linux, '192.168.1.10', 'ECONNREFUSED', 'econnrefusedHint'],
  ] as const)('%s', (_label, ua, address, message, hintKey) => {
    setUserAgent(ua);
    const result = humanizeHttpError(address, new Error(message), t);
    expect(result).toContain(message);
    expect(result).toContain(`connectionPanel.humanize.http.${hintKey}`);
  });

  it('adds mdns suffix on non-timeout errors for mdns addresses', () => {
    setUserAgent(UA.windows);
    const result = humanizeHttpError('meshtastic.local', new Error('weird failure'), t);
    expect(result).toContain('suffixMdnsWindows');
  });

  it('returns raw message for generic IP errors', () => {
    setUserAgent(UA.linux);
    expect(humanizeHttpError('192.168.1.10', new Error('weird failure'), t)).toBe('weird failure');
  });
});

describe('humanizeBleError', () => {
  const t = mockT();

  it('suppresses MeshCore setup AbortError', () => {
    setUserAgent(UA.linux);
    const err = new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
    expect(humanizeBleError(err, t)).toBe('');
  });

  it('stringifies object errors', () => {
    setUserAgent(UA.windows);
    expect(humanizeBleError({ reason: 'adapter glitch' }, t)).toContain(
      '"reason":"adapter glitch"',
    );
  });

  it.each([
    ['windows adapter', UA.windows, 'Bluetooth adapter is not available', 'adapterWindowsHint'],
    ['linux adapter', UA.linux, 'Bluetooth adapter not found', 'adapterLinuxHint'],
    ['darwin adapter', UA.darwin, 'adapter is not available', 'adapterGenericHint'],
  ] as const)('%s', (_label, ua, message, hintKey) => {
    setUserAgent(ua);
    const result = humanizeBleError(new Error(message), t);
    expect(result).toContain(`connectionPanel.humanize.ble.${hintKey}`);
  });

  it('handles SecurityError in message', () => {
    setUserAgent(UA.linux);
    const result = humanizeBleError(new Error('SecurityError: not allowed to access'), t);
    expect(result).toContain('securityPermissionHint');
  });

  it('handles GATT disconnected', () => {
    setUserAgent(UA.linux);
    const result = humanizeBleError(new Error('GATT Server is disconnected'), t);
    expect(result).toContain('gattDisconnectedHint');
  });

  it('handles GATT not supported with Linux PIN hint', () => {
    setUserAgent(UA.linux);
    const result = humanizeBleError(new Error('GATT Error: Not supported'), t);
    expect(result).toContain('gattNotSupportedBase');
    expect(result).toContain('gattNotSupportedLinuxPin');
  });

  it('handles DOMException SecurityError with Linux PIN', () => {
    setUserAgent(UA.linux);
    const err = new DOMException('pairing required', 'SecurityError');
    const result = humanizeBleError(err, t);
    expect(result).toContain('authFailedBase');
    expect(result).toContain('authFailedLinuxPin');
  });

  it('handles DOMException NetworkError on Linux vs non-Linux', () => {
    setUserAgent(UA.linux);
    const linuxResult = humanizeBleError(new DOMException('failed', 'NetworkError'), t);
    expect(linuxResult).toContain('networkFailedLinuxHint');

    setUserAgent(UA.windows);
    const winResult = humanizeBleError(new DOMException('failed', 'NetworkError'), t);
    expect(winResult).toContain('networkFailedNonLinuxHint');
  });

  it('handles connection attempt failed with Linux hint', () => {
    setUserAgent(UA.linux);
    const result = humanizeBleError(new Error('Connection Error: Connection attempt failed'), t);
    expect(result).toContain('connectionAttemptFailedLinuxHint');
  });

  it('handles MeshCore handshake with Windows extra', () => {
    setUserAgent(UA.windows);
    const result = humanizeBleError(
      new Error(
        'Bluetooth connected but MeshCore protocol handshake did not complete before disconnect/timeout.',
      ),
      t,
    );
    expect(result).toContain('meshcoreHandshakeHint');
    expect(result).toContain('meshcoreHandshakeWindowsExtra');
  });

  it('handles Noble IPC timeout with Windows extra', () => {
    setUserAgent(UA.windows);
    const result = humanizeBleError(
      new Error('Bluetooth connection timed out while opening MeshCore over Noble IPC'),
      t,
    );
    expect(result).toContain('meshcoreHandshakeWindowsExtra');
  });

  it('handles Darwin wake recovery hints', () => {
    setUserAgent(UA.darwin);
    const result = humanizeBleError(new Error('BLE connectAsync timed out'), t);
    expect(result).toContain('macWakeRecoveryHint');
  });
});

describe('humanizeBleError userAgent cleanup', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores userAgent spy between tests', () => {
    setUserAgent(UA.windows);
    expect(humanizeBleError(new Error('Bluetooth adapter not found'), mockT())).toContain(
      'adapterWindowsHint',
    );
  });
});
