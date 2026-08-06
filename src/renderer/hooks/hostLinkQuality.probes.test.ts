import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { probeHttpLinkRttMs, probeSessionMeter, probeTcpLinkRttMs } from '../lib/hostLinkQuality';

describe('probeHttpLinkRttMs / probeTcpLinkRttMs / probeSessionMeter', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.hostLink.probeHttpRtt).mockResolvedValue(33);
    vi.mocked(window.electronAPI.hostLink.probeTcpRtt).mockResolvedValue(90);
    vi.mocked(window.electronAPI.hostLink.getSessionMeter).mockResolvedValue({ rttMs: 55 });
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

  it('reads session meter via getSessionMeter', async () => {
    await expect(probeSessionMeter('meshtastic')).resolves.toBe(55);
    expect(window.electronAPI.hostLink.getSessionMeter).toHaveBeenCalledWith('meshtastic');
  });

  it('returns null when session meter is absent', async () => {
    vi.mocked(window.electronAPI.hostLink.getSessionMeter).mockResolvedValue(null);
    await expect(probeSessionMeter('meshcore')).resolves.toBeNull();
  });

  it('returns null when session meter throws', async () => {
    vi.mocked(window.electronAPI.hostLink.getSessionMeter).mockRejectedValue(new Error('boom'));
    await expect(probeSessionMeter('meshtastic')).resolves.toBeNull();
  });

  it('returns null when session meter rttMs is non-finite', async () => {
    vi.mocked(window.electronAPI.hostLink.getSessionMeter).mockResolvedValue({
      rttMs: Number.NaN,
    });
    await expect(probeSessionMeter('meshcore')).resolves.toBeNull();
  });
});
