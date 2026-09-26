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
});
