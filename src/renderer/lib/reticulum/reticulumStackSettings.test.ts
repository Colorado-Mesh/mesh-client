import { describe, expect, it } from 'vitest';

import {
  coerceAnnounceIntervalSec,
  DEFAULT_ANNOUNCE_INTERVAL_SEC,
  DEFAULT_REQUIRED_DISCOVERY_VALUE,
  parseReticulumStackSettingsPayload,
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

describe('coerceAnnounceIntervalSec', () => {
  it('returns explicit zero', () => {
    expect(coerceAnnounceIntervalSec(0)).toBe(0);
  });

  it('defaults absent values to 3600', () => {
    expect(coerceAnnounceIntervalSec(undefined)).toBe(DEFAULT_ANNOUNCE_INTERVAL_SEC);
  });
});
