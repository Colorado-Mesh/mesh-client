import { describe, expect, it, vi } from 'vitest';

import {
  clampRequiredDiscoveryValue,
  coerceAnnounceIntervalSec,
  DEFAULT_ANNOUNCE_INTERVAL_SEC,
  DEFAULT_REQUIRED_DISCOVERY_VALUE,
  parseReticulumStackSettingsPayload,
  patchReticulumStackSettings,
  validateInterfaceDiscoverySources,
} from './reticulumStackSettings';

describe('parseReticulumStackSettingsPayload', () => {
  it('defaults announce_interval_sec to 3600 when absent', () => {
    expect(
      parseReticulumStackSettingsPayload({
        enable_transport: false,
        share_instance: true,
        loglevel: 4,
      }).announce_interval_sec,
    ).toBe(DEFAULT_ANNOUNCE_INTERVAL_SEC);
  });

  it('defaults share_instance to false when absent', () => {
    expect(parseReticulumStackSettingsPayload({ enable_transport: false }).share_instance).toBe(
      false,
    );
  });

  it('preserves explicit announce_interval_sec of 0', () => {
    expect(
      parseReticulumStackSettingsPayload({
        enable_transport: false,
        share_instance: true,
        loglevel: 4,
        announce_interval_sec: 0,
      }).announce_interval_sec,
    ).toBe(0);
  });

  it('defaults consume knobs safely', () => {
    const parsed = parseReticulumStackSettingsPayload({ enable_transport: true });
    expect(parsed.autoconnect_discovered_interfaces).toBe(0);
    expect(parsed.required_discovery_value).toBe(DEFAULT_REQUIRED_DISCOVERY_VALUE);
    expect(parsed.interface_discovery_sources).toBe('');
    expect(parsed.network_identity).toBe('');
  });

  it('defaults slow_rf_announce_filter on when absent and preserves explicit false', () => {
    expect(parseReticulumStackSettingsPayload({}).slow_rf_announce_filter).toBe(true);
    expect(
      parseReticulumStackSettingsPayload({ slow_rf_announce_filter: false })
        .slow_rf_announce_filter,
    ).toBe(false);
    expect(
      parseReticulumStackSettingsPayload({ slow_rf_announce_filter: true }).slow_rf_announce_filter,
    ).toBe(true);
  });

  it('defaults autoconnect_unverified_implementations off and preserves true', () => {
    expect(parseReticulumStackSettingsPayload({}).autoconnect_unverified_implementations).toBe(
      false,
    );
    expect(
      parseReticulumStackSettingsPayload({ autoconnect_unverified_implementations: true })
        .autoconnect_unverified_implementations,
    ).toBe(true);
  });

  it('defaults stamping off and link MTU discovery on when absent', () => {
    const parsed = parseReticulumStackSettingsPayload({});
    expect(parsed.enable_stamping).toBe(false);
    expect(parsed.enforce_stamps).toBe(false);
    expect(parsed.link_mtu_discovery).toBe(true);
  });

  it('preserves explicit stamping and link MTU discovery values', () => {
    const parsed = parseReticulumStackSettingsPayload({
      enable_stamping: true,
      enforce_stamps: true,
      link_mtu_discovery: false,
    });
    expect(parsed.enable_stamping).toBe(true);
    expect(parsed.enforce_stamps).toBe(true);
    expect(parsed.link_mtu_discovery).toBe(false);
  });

  it('keeps fractional required_discovery_value', () => {
    expect(
      parseReticulumStackSettingsPayload({ required_discovery_value: 15.8 })
        .required_discovery_value,
    ).toBe(15.8);
  });

  it('parses discovery consume fields', () => {
    const parsed = parseReticulumStackSettingsPayload({
      enable_transport: true,
      autoconnect_discovered_interfaces: 3,
      required_discovery_value: 18,
      interface_discovery_sources: '521c87a83afb8f29e4455e77930b973b',
      network_identity: '/tmp/net.id',
    });
    expect(parsed.autoconnect_discovered_interfaces).toBe(3);
    expect(parsed.required_discovery_value).toBe(18);
    expect(parsed.interface_discovery_sources).toBe('521c87a83afb8f29e4455e77930b973b');
    expect(parsed.network_identity).toBe('/tmp/net.id');
  });
});

describe('validateInterfaceDiscoverySources', () => {
  it('accepts empty and valid 32-hex hashes', () => {
    expect(validateInterfaceDiscoverySources('')).toBeNull();
    expect(validateInterfaceDiscoverySources('521c87a83afb8f29e4455e77930b973b')).toBeNull();
  });

  it('rejects malformed hashes', () => {
    expect(validateInterfaceDiscoverySources('abc')).toBe('invalid');
  });
});

describe('clampRequiredDiscoveryValue', () => {
  it('allows decimals without rounding', () => {
    expect(clampRequiredDiscoveryValue(15.8)).toBe(15.8);
    expect(clampRequiredDiscoveryValue(0)).toBe(0);
  });

  it('clamps to 0..100 and defaults non-finite input', () => {
    expect(clampRequiredDiscoveryValue(-3)).toBe(0);
    expect(clampRequiredDiscoveryValue(250.5)).toBe(100);
    expect(clampRequiredDiscoveryValue(Number.NaN)).toBe(DEFAULT_REQUIRED_DISCOVERY_VALUE);
  });
});

describe('patchReticulumStackSettings', () => {
  it('sends only the provided stamping and MTU keys', async () => {
    const proxyPut = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('window', { electronAPI: { reticulum: { proxyPut } } });
    try {
      await patchReticulumStackSettings({
        enable_stamping: true,
        enforce_stamps: false,
        link_mtu_discovery: false,
      });
      expect(proxyPut).toHaveBeenCalledWith('/api/v1/stack/settings', {
        enable_stamping: true,
        enforce_stamps: false,
        link_mtu_discovery: false,
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('coerceAnnounceIntervalSec', () => {
  it('returns explicit zero', () => {
    expect(coerceAnnounceIntervalSec(0)).toBe(0);
  });

  it('defaults absent values to 3600', () => {
    expect(coerceAnnounceIntervalSec(undefined)).toBe(DEFAULT_ANNOUNCE_INTERVAL_SEC);
  });
});
