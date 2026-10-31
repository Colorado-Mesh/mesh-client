// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  ipLiteralFamily,
  isGlobalIpLiteral,
  isValidIpLiteral,
  isValidIpv4Literal,
  isValidIpv6Literal,
  parseIpv6HextetsForLiteral,
} from './ipLiteral';

describe('parseIpv6HextetsForLiteral', () => {
  it('expands compressed and dotted-quad forms', () => {
    expect(parseIpv6HextetsForLiteral('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6HextetsForLiteral('[2001:db8::1]')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIpv6HextetsForLiteral('::ffff:8.8.8.8')).toEqual([
      0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808,
    ]);
    expect(parseIpv6HextetsForLiteral('::ffff:7f00:1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIpv6HextetsForLiteral('64:ff9b::8.8.8.8')).toEqual([
      0x64, 0xff9b, 0, 0, 0, 0, 0x0808, 0x0808,
    ]);
  });

  it('rejects malformed IPv6 forms', () => {
    expect(parseIpv6HextetsForLiteral('notahex:8.8.8.8')).toBeNull();
    expect(parseIpv6HextetsForLiteral('1:2:3:4:5:6:7::8')).toBeNull();
    expect(parseIpv6HextetsForLiteral('1:2:3:4:5:6:7:8::')).toBeNull();
    expect(parseIpv6HextetsForLiteral('::::1')).toBeNull();
  });
});

describe('isValidIpLiteral', () => {
  it('accepts IPv4 and IPv6 literals', () => {
    expect(isValidIpv4Literal('8.8.8.8')).toBe(true);
    expect(isValidIpv6Literal('::1')).toBe(true);
    expect(isValidIpv6Literal('[::ffff:127.0.0.1]')).toBe(true);
    expect(isValidIpLiteral('example.com')).toBe(false);
    expect(ipLiteralFamily('8.8.8.8')).toBe(4);
    expect(ipLiteralFamily('2001:4860:4860::8888')).toBe(6);
    expect(ipLiteralFamily('example.com')).toBeNull();
  });
});

describe('isGlobalIpLiteral', () => {
  it.each([
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['0.0.0.0', false],
    ['127.0.0.1', false],
    ['10.0.0.1', false],
    ['172.16.0.1', false],
    ['172.31.255.255', false],
    ['172.32.0.1', true],
    ['192.168.1.1', false],
    ['169.254.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['100.127.255.255', false],
    ['100.128.0.1', true],
    ['224.0.0.1', false],
    ['239.255.255.255', false],
    ['240.0.0.1', false],
    ['255.255.255.255', false],
    ['198.51.100.1', false],
    ['203.0.113.1', false],
    ['192.0.2.1', false],
    ['192.88.99.1', true],
    ['192.88.99.2', false],
    ['198.18.0.1', false],
    ['192.0.0.9', true],
    ['192.0.0.1', false],
  ] as const)('IPv4 %s → %s', (addr, expected) => {
    expect(isGlobalIpLiteral(addr)).toBe(expected);
  });

  it.each([
    ['2001:4860:4860::8888', true],
    ['2001:db8::1', false],
    ['::1', false],
    ['::', false],
    ['fe80::1', false],
    ['fc00::1', false],
    ['fd12:3456:789a::1', false],
    ['ff00::1', false],
    ['ff02::1', false],
    ['::ffff:8.8.8.8', true],
    ['::ffff:127.0.0.1', false],
    ['::ffff:10.0.0.1', false],
    ['[::ffff:169.254.169.254]', false],
    ['[::ffff:100.64.0.1]', false],
    ['64:ff9b::8.8.8.8', true],
    ['64:ff9b::7f00:1', false],
    ['2001::1', false],
    ['2002::1', false],
    ['100::1', false],
    ['2001:10::1', false],
    ['2001:20::1', true],
    ['2001:1::1', true],
    ['3fff::1', false],
  ] as const)('IPv6 %s → %s', (addr, expected) => {
    expect(isGlobalIpLiteral(addr)).toBe(expected);
  });

  it('returns null for non-literals', () => {
    expect(isGlobalIpLiteral('example.com')).toBeNull();
    expect(isGlobalIpLiteral('localhost')).toBeNull();
    expect(isGlobalIpLiteral('')).toBeNull();
  });

  it.each([
    // last in blocked range → non-global; first after → global
    ['0.255.255.255', false],
    ['1.0.0.0', true],
    ['10.255.255.255', false],
    ['11.0.0.0', true],
    ['100.127.255.255', false],
    ['100.128.0.0', true],
    ['127.255.255.255', false],
    ['128.0.0.0', true],
    ['169.254.255.255', false],
    ['169.255.0.0', true],
    ['172.31.255.255', false],
    ['172.32.0.0', true],
    ['192.168.255.255', false],
    ['192.169.0.0', true],
    ['192.0.2.255', false],
    ['192.0.3.0', true],
    ['198.51.100.255', false],
    ['198.51.101.0', true],
    ['203.0.113.255', false],
    ['203.0.114.0', true],
    ['198.19.255.255', false],
    ['198.20.0.0', true],
    ['2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', false],
    ['2001:db9::', true],
  ] as const)('range boundary %s → %s', (addr, expected) => {
    expect(isGlobalIpLiteral(addr)).toBe(expected);
  });
});
