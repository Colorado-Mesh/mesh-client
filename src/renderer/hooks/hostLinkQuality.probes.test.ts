import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeHttpLinkRttMs, probeTcpLinkRttMs } from '../lib/hostLinkQuality';

describe('probeHttpLinkRttMs / probeTcpLinkRttMs', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.hostLink.probeHttpRtt).mockResolvedValue(33);
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(90);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('probes HTTP via parsed host/tls', async () => {
    await expect(probeHttpLinkRttMs('https://radio.local')).resolves.toBe(33);
    expect(window.electronAPI.hostLink.probeHttpRtt).toHaveBeenCalledWith('radio.local:443', true);
  });

  it('returns null for empty HTTP address', async () => {
    await expect(probeHttpLinkRttMs('')).resolves.toBeNull();
    expect(window.electronAPI.hostLink.probeHttpRtt).not.toHaveBeenCalled();
  });

  it('returns null when HTTP probe throws', async () => {
    vi.mocked(window.electronAPI.hostLink.probeHttpRtt).mockRejectedValue(new Error('boom'));
    await expect(probeHttpLinkRttMs('meshtastic.local')).resolves.toBeNull();
  });

  it('probes Meshtastic TCP with default port 4403', async () => {
    await expect(probeTcpLinkRttMs('10.0.0.8', 'meshtastic')).resolves.toBe(90);
    expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalledWith('10.0.0.8', 4403);
  });

  it('probes MeshCore TCP with default port 5000', async () => {
    await expect(probeTcpLinkRttMs('10.0.0.8', 'meshcore')).resolves.toBe(90);
    expect(window.electronAPI.hostLink.probeTcpRtt).toHaveBeenCalledWith('10.0.0.8', 5000);
  });

  it('returns null when TCP probe returns non-finite', async () => {
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(Number.NaN);
    await expect(probeTcpLinkRttMs('10.0.0.8', 'meshtastic')).resolves.toBeNull();
  });
});
