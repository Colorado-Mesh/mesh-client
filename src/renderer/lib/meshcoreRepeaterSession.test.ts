import { describe, expect, it, vi } from 'vitest';

import { meshcoreRepeaterTryLogin } from './meshcoreRepeaterSession';
import {
  meshcoreApplyRepeaterSessionAuth,
  meshcoreClearRepeaterRemoteSessionAuth,
} from './meshcoreUtils';

describe('meshcoreRepeaterTryLogin', () => {
  it('calls login after applying session password', async () => {
    meshcoreClearRepeaterRemoteSessionAuth();
    meshcoreApplyRepeaterSessionAuth('secret');
    const login = vi.fn().mockResolvedValue(undefined);
    const conn = { login };
    const pubKey = new Uint8Array(32);
    await meshcoreRepeaterTryLogin(conn, pubKey);
    expect(login).toHaveBeenCalledTimes(1);
    expect(login).toHaveBeenCalledWith(pubKey, 'secret', 2000);
    meshcoreClearRepeaterRemoteSessionAuth();
  });

  it('skips login when session password is empty', async () => {
    meshcoreClearRepeaterRemoteSessionAuth();
    const login = vi.fn().mockResolvedValue(undefined);
    await meshcoreRepeaterTryLogin({ login }, new Uint8Array(32));
    expect(login).not.toHaveBeenCalled();
  });
});
