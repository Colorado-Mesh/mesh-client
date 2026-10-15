import { describe, expect, it } from 'vitest';

import {
  buildExtraFieldOverrides,
  extraFieldList,
  formatNodeNumList,
  ipv4FromUint32,
  ipv4ToUint32,
  LORA_EXTRA_FIELDS,
  NETWORK_EXTRA_FIELDS,
  parseNodeNumList,
  POSITION_EXTRA_FIELDS,
  POWER_EXTRA_FIELDS,
  readExtraFieldValues,
  remoteHardwarePinsFromConfig,
  remoteHardwarePinTypeLabel,
  SECURITY_EXTRA_FIELDS,
  toggleFlag,
} from './meshtasticExtraConfigFields';

describe('ipv4 conversion', () => {
  it('round-trips with the first octet in the low byte', () => {
    const n = ipv4ToUint32('192.168.1.20');
    expect(n).toBe(192 + 168 * 256 + 1 * 65536 + 20 * 16777216);
    expect(ipv4FromUint32(n!)).toBe('192.168.1.20');
  });

  it('treats empty as 0 and rejects malformed input', () => {
    expect(ipv4ToUint32('')).toBe(0);
    expect(ipv4ToUint32('10.0.0')).toBeNull();
    expect(ipv4ToUint32('10.0.0.256')).toBeNull();
    expect(ipv4ToUint32('a.b.c.d')).toBeNull();
  });
});

describe('node number lists', () => {
  it('parses !hex, 0x and decimal, dropping duplicates', () => {
    expect(parseNodeNumList('!a1b2c3d4, 0x10 16\n42')).toEqual([0xa1b2c3d4, 16, 42]);
    expect(formatNodeNumList([0xa1b2c3d4, 16])).toBe('!a1b2c3d4, !00000010');
  });

  it('rejects junk and zero', () => {
    expect(parseNodeNumList('nope')).toBeNull();
    expect(parseNodeNumList('0')).toBeNull();
    expect(parseNodeNumList('')).toEqual([]);
  });
});

describe('readExtraFieldValues / buildExtraFieldOverrides', () => {
  it('reads nested ipv4 config and merges edits into a copy of the sub-message', () => {
    const slice = {
      addressMode: 1,
      ipv4Config: { ip: ipv4ToUint32('10.0.0.5'), gateway: 0, subnet: 0, dns: 0, extra: 'x' },
      rsyslogServer: 'logs:514',
      enabledProtocols: 1,
      ipv6Enabled: true,
    };
    const specs = extraFieldList(NETWORK_EXTRA_FIELDS);
    const values = readExtraFieldValues(slice, specs);
    expect(values['ipv4Config.ip']).toBe('10.0.0.5');
    expect(values['ipv4Config.gateway']).toBe('');
    expect(values.rsyslogServer).toBe('logs:514');

    const result = buildExtraFieldOverrides(slice, specs, {
      ...values,
      'ipv4Config.gateway': '10.0.0.1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.overrides.ipv4Config).toEqual({
      ip: ipv4ToUint32('10.0.0.5'),
      gateway: ipv4ToUint32('10.0.0.1'),
      subnet: 0,
      dns: 0,
      extra: 'x',
    });
    expect(result.overrides.addressMode).toBe(1);
    expect(result.overrides.ipv6Enabled).toBe(true);
  });

  it('reports the first unparseable field', () => {
    const specs = extraFieldList(NETWORK_EXTRA_FIELDS);
    const result = buildExtraFieldOverrides({}, specs, { 'ipv4Config.dns': '999.1.1.1' });
    expect(result).toEqual({ ok: false, invalidKey: 'ipv4Config.dns' });
  });

  it('skips ipv4Config fields when address mode is DHCP so invalid hidden values do not block apply', () => {
    const specs = extraFieldList(NETWORK_EXTRA_FIELDS);
    const result = buildExtraFieldOverrides({}, specs, {
      addressMode: 0,
      'ipv4Config.ip': 'not-an-ip',
      'ipv4Config.gateway': 'also-bad',
      rsyslogServer: 'logs:514',
    });
    expect(result).toEqual({
      ok: true,
      overrides: {
        addressMode: 0,
        rsyslogServer: 'logs:514',
        enabledProtocols: 0,
        ipv6Enabled: false,
      },
    });
  });

  it('enforces number bounds', () => {
    const specs = extraFieldList(POWER_EXTRA_FIELDS);
    const result = buildExtraFieldOverrides({}, specs, { deviceBatteryInaAddress: 200 });
    expect(result).toEqual({ ok: false, invalidKey: 'deviceBatteryInaAddress' });
  });

  it('writes powermonEnables as bigint', () => {
    const specs = extraFieldList(POWER_EXTRA_FIELDS);
    expect(readExtraFieldValues({ powermonEnables: 12n }, specs).powermonEnables).toBe('12');
    const result = buildExtraFieldOverrides({}, specs, { powermonEnables: '12' });
    expect(result.ok && result.overrides.powermonEnables).toBe(12n);
    const empty = buildExtraFieldOverrides({}, specs, { powermonEnables: '' });
    expect(empty.ok && empty.overrides.powermonEnables).toBe(0n);
  });

  it('round-trips the LoRa ignore list and FEM mode', () => {
    const specs = extraFieldList(LORA_EXTRA_FIELDS);
    const values = readExtraFieldValues(
      { ignoreIncoming: [0x1234], femLnaMode: 1, serialHalOnly: true },
      specs,
    );
    expect(values.ignoreIncoming).toBe('!00001234');
    const result = buildExtraFieldOverrides({}, specs, values);
    expect(result).toEqual({
      ok: true,
      overrides: { ignoreIncoming: [0x1234], femLnaMode: 1, serialHalOnly: true },
    });
  });

  it('exposes position flags without the UNSET member', () => {
    const values = POSITION_EXTRA_FIELDS.positionFlags.options.map((o) => o.value);
    expect(values).not.toContain(0);
    expect(values).toContain(1);
    expect(toggleFlag(0, 4, true)).toBe(4);
    expect(toggleFlag(5, 4, false)).toBe(1);
  });

  it('labels every packet signature policy', () => {
    for (const option of SECURITY_EXTRA_FIELDS.packetSignaturePolicy.options) {
      expect(option.labelKey).toMatch(/^meshtasticExtraConfig\.packetSignaturePolicies\./);
    }
  });
});

describe('remote hardware pins', () => {
  it('reads pins and labels their type', () => {
    const pins = remoteHardwarePinsFromConfig({
      availablePins: [{ gpioPin: 4, name: 'Relay', type: 2 }, null, { gpioPin: 5 }],
    });
    expect(pins).toEqual([
      { gpioPin: 4, name: 'Relay', type: 2 },
      { gpioPin: 5, name: '', type: 0 },
    ]);
    expect(remoteHardwarePinTypeLabel(2, (k) => k)).toBe('Digital Write');
    expect(remoteHardwarePinTypeLabel(99, (k) => k)).toBe('99');
  });
});
