import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mergeAppSetting } from './appSettingsStorage';
import { deserializeMeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';
import {
  MESHCORE_RADIO_ERR_BAD_STATE,
  MESHCORE_RADIO_ERR_NOT_FOUND,
  MESHCORE_RADIO_ERR_TABLE_FULL,
} from './meshcoreRadioErr';
import type { MeshcoreRadioConnection } from './meshcoreRepeaterRpcCommon';
import {
  getMeshcoreRoomAutoLoginFailure,
  setMeshcoreRoomAutoLoginFailure,
  shouldSkipMeshcoreRoomAutoLogin,
} from './meshcoreRoomAutoLoginFailure';
import {
  getMeshcoreRoomCredential,
  setMeshcoreRoomCredential,
} from './meshcoreRoomCredentialStorage';
import { MESHCORE_ROOM_LOGIN_REJECTED_MESSAGE } from './meshcoreRoomLoginRpc';
import {
  applyMeshcoreRoomLoginFailure,
  disableMeshcoreRoomAutoLogin,
  disableMeshcoreRoomLoginAfterAuthFailure,
  forgetMeshcoreRoomSavedSecrets,
  getMeshcoreRoomSavedSecretsSummary,
  meshcoreRoomRememberedCredential,
  saveMeshcoreRoomSessionPasswordIfUnsaved,
} from './meshcoreRoomSavedSecrets';
import {
  meshcoreApplyRoomSession,
  meshcoreClearAllRoomSessions,
  meshcoreClearRoomSession,
  meshcoreRoomLogin,
  meshcoreRoomLoginErrorIsAuthFailure,
} from './meshcoreRoomSession';
import {
  getMeshcoreRoomSyncConfig,
  meshcoreRoomSyncSettingForNode,
  setMeshcoreRoomSyncConfig,
} from './meshcoreRoomSyncStorage';
import {
  MC_CMD_SEND_LOGIN,
  MC_PUSH_LOGIN_FAIL,
  MC_RESP_ERR,
  MC_RESP_SENT,
} from './meshcoreWireCodes';

describe('meshcoreRoomSavedSecrets', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(window.electronAPI.appSettings.set).mockClear();
    meshcoreClearRoomSession(0x18);
  });

  it('summarizes credential and sync flags', async () => {
    await setMeshcoreRoomCredential(0x10, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x10, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    expect(getMeshcoreRoomSavedSecretsSummary(0x10)).toEqual({
      hasCredential: true,
      autoLoginOnConnect: true,
      syncEnabled: true,
    });
  });

  it('forget clears credential and disables sync and auto-login', async () => {
    await setMeshcoreRoomCredential(0x11, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x11, {
      enabled: true,
      intervalMinutes: 120,
      autoLoginOnConnect: true,
    });
    setMeshcoreRoomAutoLoginFailure(0x11, 'wrong password');
    await forgetMeshcoreRoomSavedSecrets(0x11);
    expect(getMeshcoreRoomCredential(0x11)).toBeUndefined();
    const cfg = getMeshcoreRoomSyncConfig(0x11);
    expect(cfg.enabled).toBe(false);
    expect(cfg.autoLoginOnConnect).toBe(false);
    expect(cfg.intervalMinutes).toBe(120);
    expect(getMeshcoreRoomAutoLoginFailure(0x11)).toBeUndefined();
  });

  it('disable auto-login keeps credential', async () => {
    await setMeshcoreRoomCredential(0x12, { guestPassword: 'secret' });
    mergeAppSetting(
      meshcoreRoomSyncSettingForNode(0x12),
      JSON.stringify({ enabled: true, intervalMinutes: 60, autoLoginOnConnect: true }),
      'meshcoreRoomSavedSecrets.test',
    );
    await disableMeshcoreRoomAutoLogin(0x12);
    expect(getMeshcoreRoomCredential(0x12)?.guestPassword).toBe('secret');
    expect(getMeshcoreRoomSyncConfig(0x12).autoLoginOnConnect).toBe(false);
    expect(getMeshcoreRoomSyncConfig(0x12).enabled).toBe(true);
  });

  it('disable auto-login with clearFailure false keeps failure banner', async () => {
    await setMeshcoreRoomSyncConfig(0x14, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    setMeshcoreRoomAutoLoginFailure(0x14, 'wrong password');
    await disableMeshcoreRoomAutoLogin(0x14, { clearFailure: false });
    expect(getMeshcoreRoomSyncConfig(0x14).autoLoginOnConnect).toBe(false);
    expect(getMeshcoreRoomAutoLoginFailure(0x14)).toBe('wrong password');
  });

  it('applyMeshcoreRoomLoginFailure disables sync on auth error and sets failure UI', async () => {
    await setMeshcoreRoomCredential(0x15, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x15, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    await applyMeshcoreRoomLoginFailure(
      0x15,
      new Error('room login rejected (wrong password or ACL denied)'),
      'test',
    );
    expect(getMeshcoreRoomCredential(0x15)?.guestPassword).toBe('hello');
    const cfg = getMeshcoreRoomSyncConfig(0x15);
    expect(cfg.enabled).toBe(false);
    expect(cfg.autoLoginOnConnect).toBe(false);
    expect(getMeshcoreRoomAutoLoginFailure(0x15)).toContain('rejected');
  });

  it('applyMeshcoreRoomLoginFailure sets failure but keeps sync on non-auth errors', async () => {
    await setMeshcoreRoomSyncConfig(0x16, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    await applyMeshcoreRoomLoginFailure(0x16, new Error('timeout'), 'test');
    const cfg = getMeshcoreRoomSyncConfig(0x16);
    expect(cfg.enabled).toBe(true);
    expect(cfg.autoLoginOnConnect).toBe(true);
    expect(getMeshcoreRoomAutoLoginFailure(0x16)).toBe('timeout');
    expect(shouldSkipMeshcoreRoomAutoLogin(0x16)).toBe(false);
  });

  it('applyMeshcoreRoomLoginFailure sticky-skips only on auth errors', async () => {
    await setMeshcoreRoomSyncConfig(0x17, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
    await applyMeshcoreRoomLoginFailure(
      0x17,
      new Error('room login rejected (wrong password or ACL denied)'),
      'test',
    );
    expect(shouldSkipMeshcoreRoomAutoLogin(0x17)).toBe(true);
    expect(getMeshcoreRoomSyncConfig(0x17).autoLoginOnConnect).toBe(false);
  });

  it('saves a session guest password into an admin-only record', async () => {
    await setMeshcoreRoomCredential(0x18, { adminPassword: 'ops' });
    meshcoreApplyRoomSession(0x18, {
      guestPassword: 'hello',
      adminPassword: '',
      role: 'readwrite',
    });
    expect(await saveMeshcoreRoomSessionPasswordIfUnsaved(0x18)).toBe(true);
    expect(getMeshcoreRoomCredential(0x18)).toEqual({
      guestPassword: 'hello',
      adminPassword: 'ops',
    });
    meshcoreClearRoomSession(0x18);
  });

  it('remembered login keeps a saved admin password when no new admin password is supplied', () => {
    expect(meshcoreRoomRememberedCredential('hello', '', 'ops')).toEqual({
      guestPassword: 'hello',
      adminPassword: 'ops',
    });
    expect(meshcoreRoomRememberedCredential('hello', 'new-admin', 'ops')).toEqual({
      guestPassword: 'hello',
      adminPassword: 'new-admin',
    });
    expect(meshcoreRoomRememberedCredential('', '', undefined)).toEqual({ guestPassword: '' });
  });

  it('does not save when no session guest password is available', async () => {
    await setMeshcoreRoomCredential(0x18, { adminPassword: 'ops' });
    expect(await saveMeshcoreRoomSessionPasswordIfUnsaved(0x18)).toBe(false);
    expect(getMeshcoreRoomCredential(0x18)).toEqual({ adminPassword: 'ops' });
  });

  it('disableMeshcoreRoomLoginAfterAuthFailure disables sync but keeps credential and failure', async () => {
    await setMeshcoreRoomCredential(0x13, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(0x13, {
      enabled: true,
      intervalMinutes: 90,
      autoLoginOnConnect: true,
    });
    setMeshcoreRoomAutoLoginFailure(0x13, 'room login rejected (wrong password or ACL denied)');
    await disableMeshcoreRoomLoginAfterAuthFailure(0x13);
    expect(getMeshcoreRoomCredential(0x13)?.guestPassword).toBe('hello');
    const cfg = getMeshcoreRoomSyncConfig(0x13);
    expect(cfg.enabled).toBe(false);
    expect(cfg.autoLoginOnConnect).toBe(false);
    expect(cfg.intervalMinutes).toBe(90);
    expect(getMeshcoreRoomAutoLoginFailure(0x13)).toContain('rejected');
  });
});

const REFUSAL_ROOM_ID = 0x2a;

function refusalRoomKey(): Uint8Array {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = (0x40 + i) & 0xff;
  return key;
}

type SendLoginReply = 'err-not-found' | 'err-table-full' | 'err-bad-state' | 'login-fail';

/** Companion stub: every SendLogin is answered the way `reply` says. */
function stubRoomRadio(reply: SendLoginReply): MeshcoreRadioConnection {
  const handlers = new Map<string | number, Set<(payload?: unknown) => void>>();
  const listen = (event: string | number, cb: (payload?: unknown) => void) => {
    let set = handlers.get(event);
    if (!set) {
      set = new Set();
      handlers.set(event, set);
    }
    set.add(cb);
  };
  const emit = (event: number, payload?: unknown) => {
    for (const cb of [...(handlers.get(event) ?? [])]) cb(payload);
  };
  return {
    on: listen,
    off(event, cb) {
      handlers.get(event)?.delete(cb);
    },
    once(event, cb) {
      const wrapped = (payload?: unknown) => {
        handlers.get(event)?.delete(wrapped);
        cb(payload);
      };
      listen(event, wrapped);
    },
    sendToRadioFrame(frame) {
      if (frame[0] === MC_CMD_SEND_LOGIN) {
        const prefix = frame.slice(1, 7);
        setTimeout(() => {
          if (reply === 'err-not-found') {
            emit(MC_RESP_ERR, { errCode: MESHCORE_RADIO_ERR_NOT_FOUND });
          } else if (reply === 'err-table-full') {
            emit(MC_RESP_ERR, { errCode: MESHCORE_RADIO_ERR_TABLE_FULL });
          } else if (reply === 'err-bad-state') {
            emit(MC_RESP_ERR, { errCode: MESHCORE_RADIO_ERR_BAD_STATE });
          } else {
            emit(MC_RESP_SENT, { estTimeout: 1_000 });
            emit(MC_PUSH_LOGIN_FAIL, { pubKeyPrefix: prefix });
          }
        }, 10);
      }
      return Promise.resolve();
    },
  };
}

/** The error `meshcoreRoomLogin` throws after its retries, as connect auto-login receives it. */
async function roomLoginError(reply: SendLoginReply): Promise<unknown> {
  const pending = meshcoreRoomLogin(
    stubRoomRadio(reply),
    REFUSAL_ROOM_ID,
    refusalRoomKey(),
    'hello',
    {
      guestPassword: 'hello',
    },
  ).then(
    () => undefined,
    (e: unknown) => e,
  );
  await vi.runAllTimersAsync();
  return pending;
}

describe('room login failures that reach connect auto-login', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    localStorage.clear();
    meshcoreClearAllRoomSessions();
    await setMeshcoreRoomCredential(REFUSAL_ROOM_ID, { guestPassword: 'hello' });
    await setMeshcoreRoomSyncConfig(REFUSAL_ROOM_ID, {
      enabled: true,
      intervalMinutes: 60,
      autoLoginOnConnect: true,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['err-not-found', 'meshcore.errors.radioContactMissing'],
    ['err-table-full', 'meshcore.errors.radioContactTableFull'],
    ['err-bad-state', 'meshcore.errors.roomLogin.failed'],
  ] as const)(
    'keeps auto-login and auto-sync on when the radio refuses SendLogin (%s)',
    async (reply, messageKey) => {
      const error = await roomLoginError(reply);
      expect(error).toBeInstanceOf(Error);
      expect(deserializeMeshcoreUserMessage((error as Error).message)).toEqual({
        key: messageKey,
      });
      expect(meshcoreRoomLoginErrorIsAuthFailure(error)).toBe(false);

      await applyMeshcoreRoomLoginFailure(REFUSAL_ROOM_ID, error, 'test');

      const cfg = getMeshcoreRoomSyncConfig(REFUSAL_ROOM_ID);
      expect(cfg.autoLoginOnConnect).toBe(true);
      expect(cfg.enabled).toBe(true);
      expect(shouldSkipMeshcoreRoomAutoLogin(REFUSAL_ROOM_ID)).toBe(false);
      expect(getMeshcoreRoomAutoLoginFailure(REFUSAL_ROOM_ID)).toBeDefined();
    },
  );

  it('still turns auto-login and auto-sync off when the room answers LoginFail', async () => {
    const error = await roomLoginError('login-fail');
    expect(meshcoreRoomLoginErrorIsAuthFailure(error)).toBe(true);

    await applyMeshcoreRoomLoginFailure(REFUSAL_ROOM_ID, error, 'test');

    const cfg = getMeshcoreRoomSyncConfig(REFUSAL_ROOM_ID);
    expect(cfg.autoLoginOnConnect).toBe(false);
    expect(cfg.enabled).toBe(false);
    expect(shouldSkipMeshcoreRoomAutoLogin(REFUSAL_ROOM_ID)).toBe(true);
  });

  it.each([
    ['a route programming refusal', new Error('radio rejected request')],
    ['a path hash refusal', new Error('radio rejected path hash mode')],
    ['an unrelated error that says rejected', new Error('Promise rejected')],
  ])('does not treat %s before SendLogin as a wrong password', async (_label, error) => {
    expect(meshcoreRoomLoginErrorIsAuthFailure(error)).toBe(false);
    await applyMeshcoreRoomLoginFailure(REFUSAL_ROOM_ID, error, 'test');
    expect(getMeshcoreRoomSyncConfig(REFUSAL_ROOM_ID).autoLoginOnConnect).toBe(true);
  });

  it('recognises the LoginFail message on its own', () => {
    expect(
      meshcoreRoomLoginErrorIsAuthFailure(new Error(MESHCORE_ROOM_LOGIN_REJECTED_MESSAGE)),
    ).toBe(true);
  });
});
