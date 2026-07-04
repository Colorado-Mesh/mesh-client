// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  formatConnectHostLiteral,
  formatHostForSocket,
  formatHostForUrl,
  isLinkLocalIpv6,
  isLocalConnectHost,
  isLoopbackHost,
  isPrivateNetworkHost,
  isUniqueLocalIpv6,
  isValidConnectHost,
  parseConnectHostPort,
  stripConnectHostBrackets,
} from './connectHost';

describe('stripConnectHostBrackets', () => {
  it('strips bracketed IPv6', () => {
    expect(stripConnectHostBrackets('[::1]')).toBe('::1');
    expect(stripConnectHostBrackets('[2001:db8::1]')).toBe('2001:db8::1');
  });

  it('leaves bare hosts unchanged', () => {
    expect(stripConnectHostBrackets('192.168.1.1')).toBe('192.168.1.1');
    expect(stripConnectHostBrackets('::1')).toBe('::1');
  });
});

describe('isValidConnectHost', () => {
  it('accepts DNS hostnames and IPv4', () => {
    expect(isValidConnectHost('example.com')).toBe(true);
    expect(isValidConnectHost('my-router.local')).toBe(true);
    expect(isValidConnectHost('192.168.1.1')).toBe(true);
    expect(isValidConnectHost('sub.domain.example.org')).toBe(true);
  });

  it('accepts IPv6 bare and bracketed', () => {
    expect(isValidConnectHost('::1')).toBe(true);
    expect(isValidConnectHost('[::1]')).toBe(true);
    expect(isValidConnectHost('fd00::1')).toBe(true);
    expect(isValidConnectHost('[2001:db8::1]')).toBe(true);
    expect(isValidConnectHost('fe80::1')).toBe(true);
  });

  it('rejects invalid hosts', () => {
    expect(isValidConnectHost('')).toBe(false);
    expect(isValidConnectHost('host with spaces')).toBe(false);
    expect(isValidConnectHost('-leading-hyphen.com')).toBe(false);
    expect(isValidConnectHost('has..double.dot')).toBe(false);
    expect(isValidConnectHost('999.999.999.999')).toBe(false);
    expect(isValidConnectHost('gggg::1')).toBe(false);
  });
});

describe('local network classification', () => {
  it('detects RFC1918 IPv4', () => {
    expect(isPrivateNetworkHost('10.0.0.1')).toBe(true);
    expect(isPrivateNetworkHost('172.16.0.1')).toBe(true);
    expect(isPrivateNetworkHost('192.168.1.10')).toBe(true);
    expect(isPrivateNetworkHost('8.8.8.8')).toBe(false);
  });

  it('detects RFC4193 ULA and link-local IPv6', () => {
    expect(isUniqueLocalIpv6('fd00::1')).toBe(true);
    expect(isUniqueLocalIpv6('fc00::1')).toBe(true);
    expect(isUniqueLocalIpv6('2001:db8::1')).toBe(false);
    expect(isLinkLocalIpv6('fe80::1')).toBe(true);
    expect(isLinkLocalIpv6('febf::1')).toBe(true);
    expect(isLinkLocalIpv6('fd00::1')).toBe(false);
  });

  it('detects loopback', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('192.168.1.1')).toBe(false);
  });

  it('classifies local connect hosts for error hints', () => {
    expect(isLocalConnectHost('192.168.1.10')).toBe(true);
    expect(isLocalConnectHost('fd00::1')).toBe(true);
    expect(isLocalConnectHost('fe80::1')).toBe(true);
    expect(isLocalConnectHost('::1')).toBe(true);
    expect(isLocalConnectHost('meshtastic.local')).toBe(true);
    expect(isLocalConnectHost('node.meshtastic.local')).toBe(true);
    expect(isLocalConnectHost('radio.local')).toBe(true);
    expect(isLocalConnectHost('8.8.8.8')).toBe(false);
    expect(isLocalConnectHost('2001:db8::1')).toBe(false);
  });
});

describe('formatHostForUrl / formatHostForSocket', () => {
  it('formats IPv4 and hostname with optional port', () => {
    expect(formatHostForUrl('192.168.1.1')).toBe('192.168.1.1');
    expect(formatHostForUrl('192.168.1.1', 8080)).toBe('192.168.1.1:8080');
    expect(formatHostForUrl('meshtastic.local', 443)).toBe('meshtastic.local:443');
  });

  it('brackets IPv6 for URLs', () => {
    expect(formatHostForUrl('::1')).toBe('[::1]');
    expect(formatHostForUrl('::1', 443)).toBe('[::1]:443');
    expect(formatHostForUrl('[fd00::1]', 8080)).toBe('[fd00::1]:8080');
  });

  it('returns unbracketed host for sockets', () => {
    expect(formatHostForSocket('[::1]')).toBe('::1');
    expect(formatHostForSocket('192.168.1.1')).toBe('192.168.1.1');
  });
});

describe('parseConnectHostPort', () => {
  it('returns default port for bare hostname', () => {
    expect(parseConnectHostPort('localhost', 5000)).toEqual({ host: 'localhost', port: 5000 });
  });

  it('parses host:port for IPv4 and hostname', () => {
    expect(parseConnectHostPort('localhost:5001', 5000)).toEqual({ host: 'localhost', port: 5001 });
    expect(parseConnectHostPort('192.168.1.100:4403', 5000)).toEqual({
      host: '192.168.1.100',
      port: 4403,
    });
  });

  it('returns default port when port part is invalid', () => {
    expect(parseConnectHostPort('localhost:abc', 5000)).toEqual({
      host: 'localhost:abc',
      port: 5000,
    });
    expect(parseConnectHostPort('localhost:0', 5000)).toEqual({ host: 'localhost:0', port: 5000 });
  });

  it('treats bare IPv6 as host with default port', () => {
    expect(parseConnectHostPort('::1', 5000)).toEqual({ host: '::1', port: 5000 });
    expect(parseConnectHostPort('2001:db8::1', 5000)).toEqual({
      host: '2001:db8::1',
      port: 5000,
    });
  });

  it('parses bracketed IPv6 with port and returns unbracketed host', () => {
    expect(parseConnectHostPort('[::1]:5000', 5000)).toEqual({ host: '::1', port: 5000 });
    expect(parseConnectHostPort('[::1]:4403', 5000)).toEqual({ host: '::1', port: 4403 });
  });

  it('parses ambiguous IPv6 with trailing port', () => {
    expect(parseConnectHostPort('2001:db8::1:9000', 5000)).toEqual({
      host: '2001:db8::1',
      port: 9000,
    });
  });

  it('strips http scheme and trailing slashes', () => {
    expect(parseConnectHostPort('http://192.168.1.1:8080/', 80)).toEqual({
      host: '192.168.1.1',
      port: 8080,
    });
    expect(parseConnectHostPort('https://[fd00::1]:443', 80)).toEqual({
      host: 'fd00::1',
      port: 443,
    });
  });
});

describe('formatConnectHostLiteral', () => {
  it('brackets IPv6 literals only', () => {
    expect(formatConnectHostLiteral('192.168.1.42')).toBe('192.168.1.42');
    expect(formatConnectHostLiteral('2001:db8::1')).toBe('[2001:db8::1]');
    expect(formatConnectHostLiteral('[fd00::1]')).toBe('[fd00::1]');
  });
});
