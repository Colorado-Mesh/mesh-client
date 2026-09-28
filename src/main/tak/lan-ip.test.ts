import os from 'os';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getLanIp, isIpv4Family } from './lan-ip';

describe('lan-ip', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isIpv4Family accepts string and numeric family', () => {
    expect(isIpv4Family('IPv4')).toBe(true);
    expect(isIpv4Family(4)).toBe(true);
    expect(isIpv4Family('IPv6')).toBe(false);
    expect(isIpv4Family(6)).toBe(false);
  });

  it('getLanIp returns first non-internal IPv4 (string family)', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' } as os.NetworkInterfaceInfo],
      eth0: [
        { family: 'IPv4', internal: false, address: '192.168.1.10' } as os.NetworkInterfaceInfo,
      ],
    });
    expect(getLanIp()).toBe('192.168.1.10');
  });

  it('accepts numeric family 4 from networkInterfaces', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      en0: [
        { family: 4, internal: false, address: '10.0.0.5' } as unknown as os.NetworkInterfaceInfo,
      ],
    });
    expect(getLanIp()).toBe('10.0.0.5');
  });

  it('falls back to 127.0.0.1 when no LAN IPv4 exists', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' } as os.NetworkInterfaceInfo],
    });
    expect(getLanIp()).toBe('127.0.0.1');
    expect(warn).toHaveBeenCalled();
  });

  it('prefers eth0 RFC1918 over docker0 even when docker0 is listed first', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      docker0: [
        { family: 'IPv4', internal: false, address: '172.17.0.1' } as os.NetworkInterfaceInfo,
      ],
      eth0: [
        { family: 'IPv4', internal: false, address: '192.168.1.20' } as os.NetworkInterfaceInfo,
      ],
    });
    expect(getLanIp()).toBe('192.168.1.20');
  });

  it('prefers wlan0 RFC1918 over a VPN interface', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      tailscale0: [
        { family: 'IPv4', internal: false, address: '10.66.0.5' } as os.NetworkInterfaceInfo,
      ],
      wlan0: [
        { family: 'IPv4', internal: false, address: '192.168.1.33' } as os.NetworkInterfaceInfo,
      ],
    });
    expect(getLanIp()).toBe('192.168.1.33');
  });

  it('falls back to a virtual IPv4 when no physical RFC1918 qualifies', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      eth0: [
        { family: 'IPv4', internal: false, address: '169.254.8.8' } as os.NetworkInterfaceInfo,
      ],
      docker0: [
        { family: 'IPv4', internal: false, address: '172.17.0.1' } as os.NetworkInterfaceInfo,
      ],
    });
    expect(getLanIp()).toBe('172.17.0.1');
    expect(warn).not.toHaveBeenCalled();
  });

  it('picks the same physical address regardless of interface enumeration order', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      wlan0: [
        { family: 'IPv4', internal: false, address: '192.168.1.33' } as os.NetworkInterfaceInfo,
      ],
      eth0: [{ family: 'IPv4', internal: false, address: '10.1.1.5' } as os.NetworkInterfaceInfo],
    });
    expect(getLanIp()).toBe('10.1.1.5');
  });
});
