import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/renderer/lib/i18n', () => ({
  default: {
    t: (key: string) => key,
  },
}));

import { RNCP_REQUEST_ENABLE_SENTINEL } from '@/shared/rncpRequestEnable';

import { resetRncpRequestEnableRateLimitForTests } from './rncpRequestEnableRateLimit';
import { sendRncpRequestEnable } from './sendRncpRequestEnable';

describe('sendRncpRequestEnable', () => {
  beforeEach(() => {
    resetRncpRequestEnableRateLimitForTests();
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockReset();
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockResolvedValue({ ok: true });
  });

  it('rejects non-32-hex peer hashes', async () => {
    await expect(sendRncpRequestEnable('short')).resolves.toEqual({
      ok: false,
      error: 'invalid_peer',
    });
    expect(window.electronAPI.reticulum.proxyPost).not.toHaveBeenCalled();
  });

  it('posts destination_hash and human enable-request text', async () => {
    const hash = 'ab'.repeat(16);
    await expect(sendRncpRequestEnable(hash)).resolves.toEqual({ ok: true });
    expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/send', {
      destination_hash: hash,
      text: 'reticulumRemote.enableRequest.lxmfBody',
    });
    const text = (
      vi.mocked(window.electronAPI.reticulum.proxyPost).mock.calls[0]?.[1] as { text: string }
    ).text;
    expect(text).not.toContain(RNCP_REQUEST_ENABLE_SENTINEL);
  });

  it('rate-limits a second send to the same peer within the cooldown', async () => {
    const hash = 'ab'.repeat(16);
    await expect(sendRncpRequestEnable(hash)).resolves.toEqual({ ok: true });
    await expect(sendRncpRequestEnable(hash)).resolves.toEqual({
      ok: false,
      error: 'rate_limited',
    });
    expect(window.electronAPI.reticulum.proxyPost).toHaveBeenCalledTimes(1);
  });

  it('maps proxyPost failure to send_failed', async () => {
    const hash = 'cd'.repeat(16);
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockResolvedValue({
      ok: false,
      error: 'offline',
    });
    await expect(sendRncpRequestEnable(hash)).resolves.toEqual({
      ok: false,
      error: 'send_failed',
      detail: 'offline',
    });
  });

  it('maps proxyPost throw to send_failed', async () => {
    const hash = 'ef'.repeat(16);
    vi.mocked(window.electronAPI.reticulum.proxyPost).mockRejectedValueOnce(
      new Error('network down'),
    );
    await expect(sendRncpRequestEnable(hash)).resolves.toEqual({
      ok: false,
      error: 'send_failed',
      detail: 'network down',
    });
  });
});
