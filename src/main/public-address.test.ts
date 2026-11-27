// @vitest-environment node
import dns from 'node:dns/promises';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { pinnedLookup, resolvePublicAddress } from './public-address';

vi.mock('node:dns/promises', () => ({
  default: { lookup: vi.fn() },
  lookup: vi.fn(),
}));

const MESSAGES = { timeout: 'lookup timed out', notPublic: 'needs a public address' };

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(dns.lookup).mockReset();
});

describe('resolvePublicAddress', () => {
  it('resolves a global address', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '93.184.216.34', family: 4 });
    await expect(resolvePublicAddress('example.org', MESSAGES)).resolves.toEqual({
      address: '93.184.216.34',
      family: 4,
    });
    expect(dns.lookup).toHaveBeenCalledWith('example.org', { order: 'verbatim' });
  });

  it('rejects a private address with the notPublic message', async () => {
    vi.mocked(dns.lookup).mockResolvedValue({ address: '10.0.0.5', family: 4 });
    await expect(resolvePublicAddress('intranet.example.org', MESSAGES)).rejects.toThrow(
      'needs a public address',
    );
  });

  it('rejects after timeoutMs with the timeout message', async () => {
    vi.useFakeTimers();
    vi.mocked(dns.lookup).mockReturnValue(new Promise(() => undefined) as never);
    const pending = resolvePublicAddress('slow.example.org', MESSAGES, 50);
    const assertion = expect(pending).rejects.toThrow('lookup timed out');
    await vi.advanceTimersByTimeAsync(60);
    await assertion;
  });
});

describe('pinnedLookup', () => {
  it('answers both all and single lookups with the pinned address', () => {
    const lookup = pinnedLookup({ address: '2606:2800:220:1::1', family: 6 });
    const all = vi.fn();
    lookup('example.org', { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: '2606:2800:220:1::1', family: 6 }]);
    const single = vi.fn();
    lookup('example.org', {}, single);
    expect(single).toHaveBeenCalledWith(null, '2606:2800:220:1::1', 6);
  });
});
