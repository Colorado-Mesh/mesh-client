// @vitest-environment jsdom
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MESHCORE_SETUP_ABORT_MESSAGE } from './bleConnectErrors';
import {
  hostFromAddressInput,
  humanizeBleError,
  humanizeHttpError,
  humanizeReticulumSidecarError,
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

function mockPlatform(platform: 'linux' | 'darwin' | 'win32'): void {
  if (typeof window === 'undefined') {
    vi.stubGlobal('window', {
      electronAPI: { getPlatform: vi.fn(() => platform) },
      navigator: { userAgent: '' },
    });
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (!window.electronAPI) {
    window.electronAPI = { getPlatform: vi.fn(() => platform) } as typeof window.electronAPI;
  }
  vi.spyOn(window.electronAPI, 'getPlatform').mockReturnValue(platform);
}

describe('hostFromAddressInput / isMeshtasticLocalAddress', () => {
  it('parses host from bare IP and mdns hostname', () => {
    expect(hostFromAddressInput('192.168.1.10')).toBe('192.168.1.10');
    expect(hostFromAddressInput('http://meshtastic.local')).toBe('meshtastic.local');
    expect(isMeshtasticLocalAddress('meshtastic.local')).toBe(true);
    expect(isMeshtasticLocalAddress('node.meshtastic.local')).toBe(true);
    expect(isMeshtasticLocalAddress('radio.local')).toBe(true);
    // Regression #610: private/ULA/loopback are local hosts but not mDNS — Bonjour copy must not apply.
    expect(isMeshtasticLocalAddress('192.168.1.10')).toBe(false);
    expect(isMeshtasticLocalAddress('fd00::1')).toBe(false);
    expect(isMeshtasticLocalAddress('fe80::1')).toBe(false);
    expect(isMeshtasticLocalAddress('::1')).toBe(false);
    expect(isMeshtasticLocalAddress('8.8.8.8')).toBe(false);
    expect(isMeshtasticLocalAddress('2001:db8::1')).toBe(false);
  });

  it('parses IPv6 from bracketed host:port input', () => {
    expect(hostFromAddressInput('[fd00::1]:8080')).toBe('fd00::1');
  });
});

describe('humanizeSerialError', () => {
  const t = mockT();

  it.each([
    ['win32', 'win32', 'access denied', 'accessDeniedWindowsHint'],
    ['linux', 'linux', 'permission denied', 'accessDeniedLinuxHint'],
    ['darwin', 'darwin', 'access denied', 'disconnectedHint'],
    ['any', 'linux', 'device not found', 'disconnectedHint'],
    ['any', 'linux', 'connection timed out', 'timeoutHint'],
    ['any', 'linux', 'port is already open', 'portStillOpenHint'],
  ] as const)('maps %s serial error "%s"', (_label, platform, message, hintKey) => {
    mockPlatform(platform);
    const result = humanizeSerialError(new Error(message), t);
    expect(result).toContain(message);
    expect(result).toContain(`connectionPanel.humanize.serial.${hintKey}`);
  });

  it('returns raw message when no pattern matches', () => {
    mockPlatform('linux');
    expect(humanizeSerialError(new Error('unknown serial fault'), t)).toBe('unknown serial fault');
  });
});

describe('humanizeHttpError', () => {
  const t = mockT();

  it.each([
    [
      'mdns windows timeout',
      'win32',
      'meshtastic.local',
      'request timed out',
      'timeoutMdnsWindows',
    ],
    ['mdns non-windows timeout', 'linux', 'meshtastic.local', 'timeout', 'timeoutMdnsNonWindows'],
    ['private ip timeout linux', 'linux', '192.168.1.10', 'aborted', 'timeoutGeneric'],
    ['private ip timeout darwin', 'darwin', '192.168.4.35', 'timeout', 'timeoutGeneric'],
    ['private ip timeout win32', 'win32', '192.168.1.10', 'timed out', 'timeoutGeneric'],
    ['public ip timeout', 'linux', '8.8.8.8', 'aborted', 'timeoutGeneric'],
    ['unauthorized', 'linux', '192.168.1.10', '401 unauthorized', 'unauthorizedHint'],
    ['refused', 'linux', '192.168.1.10', 'ECONNREFUSED', 'econnrefusedHint'],
  ] as const)('%s', (_label, platform, address, message, hintKey) => {
    mockPlatform(platform);
    const result = humanizeHttpError(address, new Error(message), t);
    expect(result).toContain(message);
    expect(result).toContain(`connectionPanel.humanize.http.${hintKey}`);
  });

  // Regression #610: do not re-broaden isMeshtasticLocalAddress to isLocalConnectHost.
  it.each(['win32', 'darwin', 'linux'] as const)(
    'does not attach Bonjour/mDNS timeout hints to private IPs on %s',
    (platform) => {
      mockPlatform(platform);
      const result = humanizeHttpError('192.168.4.35', new Error('connection timed out'), t);
      expect(result).toContain('timeoutGeneric');
      expect(result).not.toContain('timeoutMdnsWindows');
      expect(result).not.toContain('timeoutMdnsNonWindows');
      expect(result).not.toContain('suffixMdnsWindows');
      expect(result).not.toContain('suffixMdnsNonWindows');
    },
  );

  it('adds mDNS suffix on non-timeout errors for .local hosts only', () => {
    mockPlatform('win32');
    const mdnsResult = humanizeHttpError('meshtastic.local', new Error('weird failure'), t);
    expect(mdnsResult).toContain('suffixMdnsWindows');

    mockPlatform('linux');
    const mdnsNonWin = humanizeHttpError('meshtastic.local', new Error('weird failure'), t);
    expect(mdnsNonWin).toContain('suffixMdnsNonWindows');
  });

  it('returns raw message for private-IP non-timeout errors (no Bonjour suffix)', () => {
    mockPlatform('win32');
    expect(humanizeHttpError('192.168.1.10', new Error('weird failure'), t)).toBe('weird failure');
  });

  it('returns raw message for generic public IP errors', () => {
    mockPlatform('linux');
    expect(humanizeHttpError('8.8.8.8', new Error('weird failure'), t)).toBe('weird failure');
  });

  it.each(['win32', 'darwin'] as const)(
    'suppresses MeshCore setup AbortError on private IP (%s)',
    (platform) => {
      mockPlatform(platform);
      const err = new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
      expect(humanizeHttpError('192.168.4.35', err, t)).toBe('');
    },
  );
});

describe('humanizeBleError', () => {
  const t = mockT();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('suppresses MeshCore setup AbortError', () => {
    mockPlatform('linux');
    const err = new DOMException(MESHCORE_SETUP_ABORT_MESSAGE, 'AbortError');
    expect(humanizeBleError(err, t)).toBe('');
  });

  it('stringifies object errors', () => {
    mockPlatform('win32');
    expect(humanizeBleError({ reason: 'adapter glitch' }, t)).toContain(
      '"reason":"adapter glitch"',
    );
  });

  it.each([
    ['win32 adapter', 'win32', 'Bluetooth adapter is not available', 'adapterWindowsHint'],
    ['linux adapter', 'linux', 'Bluetooth adapter not found', 'adapterLinuxHint'],
    ['darwin adapter', 'darwin', 'adapter is not available', 'adapterGenericHint'],
  ] as const)('%s', (_label, platform, message, hintKey) => {
    mockPlatform(platform);
    const result = humanizeBleError(new Error(message), t);
    expect(result).toContain(`connectionPanel.humanize.ble.${hintKey}`);
  });

  it('handles SecurityError in message', () => {
    mockPlatform('linux');
    const result = humanizeBleError(new Error('SecurityError: not allowed to access'), t);
    expect(result).toContain('securityPermissionHint');
  });

  it('handles GATT disconnected', () => {
    mockPlatform('linux');
    const result = humanizeBleError(new Error('GATT Server is disconnected'), t);
    expect(result).toContain('gattDisconnectedHint');
  });

  it('handles GATT not supported with Linux PIN hint', () => {
    mockPlatform('linux');
    const result = humanizeBleError(new Error('GATT Error: Not supported'), t);
    expect(result).toContain('gattNotSupportedBase');
    expect(result).toContain('gattNotSupportedLinuxPin');
  });

  it('handles DOMException SecurityError with Linux PIN', () => {
    mockPlatform('linux');
    const err = new DOMException('pairing required', 'SecurityError');
    const result = humanizeBleError(err, t);
    expect(result).toContain('authFailedBase');
    expect(result).toContain('authFailedLinuxPin');
  });

  it('handles DOMException NetworkError on Linux vs non-Linux', () => {
    mockPlatform('linux');
    const linuxResult = humanizeBleError(new DOMException('failed', 'NetworkError'), t);
    expect(linuxResult).toContain('networkFailedLinuxHint');

    mockPlatform('win32');
    const winResult = humanizeBleError(new DOMException('failed', 'NetworkError'), t);
    expect(winResult).toContain('networkFailedNonLinuxHint');
  });

  it('handles connection attempt failed with Linux hint', () => {
    mockPlatform('linux');
    const result = humanizeBleError(new Error('Connection Error: Connection attempt failed'), t);
    expect(result).toContain('connectionAttemptFailedLinuxHint');
  });

  it('handles MeshCore handshake with Windows extra', () => {
    mockPlatform('win32');
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
    mockPlatform('win32');
    const result = humanizeBleError(
      new Error('Bluetooth connection timed out while opening MeshCore over Noble IPC'),
      t,
    );
    expect(result).toContain('meshcoreHandshakeWindowsExtra');
  });

  it('adds dual-protocol contention hint for already-in-progress BLE errors', () => {
    mockPlatform('darwin');
    const result = humanizeBleError(
      new Error(
        'Bluetooth connection already in progress. Wait for it to finish or try Serial/USB instead.',
      ),
      t,
    );
    expect(result).toContain('dualProtocolContentionHint');
  });

  it.each([
    ['connectAsync timed out', 'BLE connectAsync timed out'],
    ['unknown peripheral', 'unknown peripheral id in noble cache'],
    ['peripheral not found', 'BLE peripheral not found after scan'],
  ] as const)('handles Darwin wake recovery for %s', (_label, message) => {
    mockPlatform('darwin');
    const result = humanizeBleError(new Error(message), t);
    expect(result).toContain(message);
    expect(result).toContain('macWakeRecoveryHint');
  });

  it('does not double-append macOS wake hint when message already includes guidance', () => {
    mockPlatform('darwin');
    const message = 'BLE connectAsync timed out — toggle Bluetooth off/on';
    const result = humanizeBleError(new Error(message), t);
    expect(result).toContain('macWakeRecoveryHint');
    expect(result.split('macWakeRecoveryHint').length - 1).toBe(1);
  });

  it('humanizes requestDevice chooser cancel with a non-empty hint', () => {
    mockPlatform('linux');
    const result = humanizeBleError(new Error('User cancelled the requestDevice() chooser.'), t);
    expect(result).not.toBe('');
    expect(result).toContain('chooserCancelledHint');
  });

  it('humanizes missing bluetoothctl with a non-empty hint', () => {
    mockPlatform('linux');
    const result = humanizeBleError(new Error('bluetoothctl not found'), t);
    expect(result).not.toBe('');
    expect(result).toContain('bluetoothctlMissingHint');
  });
});

describe('humanizeReticulumSidecarError', () => {
  const t = mockT();

  it('maps missing sidecar binary to build hint', () => {
    expect(
      humanizeReticulumSidecarError(
        new Error('Reticulum sidecar binary not found: /tmp/mesh-client-reticulum'),
        t,
      ),
    ).toBe('connectionPanel.reticulumSidecarMissing');
  });

  it('maps missing packaged sidecar to upgrade hint', () => {
    expect(
      humanizeReticulumSidecarError(
        new Error('RETICULUM_SIDECAR_BUNDLED_MISSING: packaged sidecar binary not found'),
        t,
      ),
    ).toBe('connectionPanel.reticulumSidecarBundledMissing');
  });

  it('maps missing cargo to rustup hint', () => {
    expect(
      humanizeReticulumSidecarError(new Error('RETICULUM_CARGO_MISSING: cargo not found'), t),
    ).toBe('connectionPanel.reticulumSidecarCargoMissing');
  });

  it('maps missing rsReticulum packet-tap overlay to patch hint', () => {
    expect(
      humanizeReticulumSidecarError(
        new Error('RETICULUM_RNS_PATCH_MISSING: register_packet_tap not found'),
        t,
      ),
    ).toBe('connectionPanel.reticulumSidecarPatchMissing');
  });
});
