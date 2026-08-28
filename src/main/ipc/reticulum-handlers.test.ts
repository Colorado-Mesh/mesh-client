// @vitest-environment node
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

const { showItemInFolderMock } = vi.hoisted(() => ({
  showItemInFolderMock: vi.fn(),
}));

const { memoAudioRateLimitMock } = vi.hoisted(() => ({
  memoAudioRateLimitMock: {
    checkOrThrow: vi.fn(),
    resetForTests: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
  shell: { showItemInFolder: showItemInFolderMock },
}));

vi.mock('../ipcRateLimit', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.importOriginal needs typeof import()
  const actual = await importOriginal<typeof import('../ipcRateLimit')>();
  return {
    ...actual,
    createIpcRateLimiter: (...args: Parameters<typeof actual.createIpcRateLimiter>) => {
      const [opts] = args;
      if (opts.label === 'reticulum:voiceMemoSendAudio') {
        return memoAudioRateLimitMock;
      }
      return actual.createIpcRateLimiter(...args);
    },
  };
});

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

vi.mock('../log-service', () => ({
  sanitizeLogMessage: (s: string) => s,
}));

vi.mock('../reticulum-config-paths', () => ({
  readFirstExistingConfig: vi.fn(),
  showReticulumConfigImportDialog: vi.fn(),
  showNomadContentSourceDialog: vi.fn(),
  isAllowedNomadContentSourcePath: vi.fn((path: string | null) => Boolean(path?.trim())),
  isNomadContentSourceApiPath: vi.fn(
    (apiPath: string) =>
      apiPath === '/api/v1/nomadnetwork/serving/content-source' ||
      apiPath.endsWith('/nomadnetwork/serving/content-source'),
  ),
  NOMAD_CONTENT_SOURCE_API_PATH: '/api/v1/nomadnetwork/serving/content-source',
}));

vi.mock('../reticulum-config-validate', () => ({
  validateReticulumUserConfig: vi.fn(),
}));

vi.mock('../reticulum-identity-import', () => ({
  showReticulumIdentityImportDialog: vi.fn(),
  showReticulumIdentityBackupImportDialog: vi.fn(),
  saveReticulumIdentityExportDialog: vi.fn(),
}));

vi.mock('../reticulum-blocklist-file', () => ({
  saveBlocklistToFile: vi.fn(() => Promise.resolve({ path: null, error: null })),
  readBlocklistFromFile: vi.fn(() => Promise.resolve({ hashes: null, skipped: 0, error: null })),
}));

vi.mock('../reticulum-remote-paths', () => ({
  showRncpOpenFileDialog: vi.fn(),
  showRncpSaveDirectoryDialog: vi.fn(),
  isAllowedRncpSendFilePath: vi.fn(() => false),
  isAllowedRncpSaveDirectoryPath: vi.fn(() => false),
  isAllowedRncpRevealPath: vi.fn(() => false),
  isRncpPickerGatedApiPath: vi.fn(
    (apiPath: string) =>
      apiPath === '/api/v1/rncp/send' ||
      apiPath === '/api/v1/rncp/fetch' ||
      apiPath === '/api/v1/rncp/listener',
  ),
}));

import {
  VOICE_MEMO_AUDIO_API_PATH,
  VOICE_MEMO_CANCEL_API_PATH,
  VOICE_MEMO_DATA_BASE64_MAX,
  VOICE_MEMO_START_API_PATH,
  VOICE_MEMO_STOP_API_PATH,
} from '../../shared/reticulum-voice-memo-types';
import {
  isAllowedNomadContentSourcePath,
  readFirstExistingConfig,
  showNomadContentSourceDialog,
  showReticulumConfigImportDialog,
} from '../reticulum-config-paths';
import { validateReticulumUserConfig } from '../reticulum-config-validate';
import { showReticulumIdentityImportDialog } from '../reticulum-identity-import';
import {
  isAllowedRncpRevealPath,
  isAllowedRncpSaveDirectoryPath,
  isAllowedRncpSendFilePath,
  showRncpOpenFileDialog,
  showRncpSaveDirectoryDialog,
} from '../reticulum-remote-paths';
import { assertIpcSender } from '../validate-ipc-sender';
import { registerReticulumIpcHandlers, wireReticulumSidecarBridge } from './reticulum-handlers';

type IpcHandler = (event: unknown, ...args: unknown[]) => unknown;

const assertIpcSenderMock = vi.mocked(assertIpcSender);
const readFirstExistingConfigMock = vi.mocked(readFirstExistingConfig);
const showReticulumConfigImportDialogMock = vi.mocked(showReticulumConfigImportDialog);
const showNomadContentSourceDialogMock = vi.mocked(showNomadContentSourceDialog);
const isAllowedNomadContentSourcePathMock = vi.mocked(isAllowedNomadContentSourcePath);
const validateReticulumUserConfigMock = vi.mocked(validateReticulumUserConfig);
const showReticulumIdentityImportDialogMock = vi.mocked(showReticulumIdentityImportDialog);
const showRncpOpenFileDialogMock = vi.mocked(showRncpOpenFileDialog);
const showRncpSaveDirectoryDialogMock = vi.mocked(showRncpSaveDirectoryDialog);
const isAllowedRncpSendFilePathMock = vi.mocked(isAllowedRncpSendFilePath);
const isAllowedRncpSaveDirectoryPathMock = vi.mocked(isAllowedRncpSaveDirectoryPath);
const isAllowedRncpRevealPathMock = vi.mocked(isAllowedRncpRevealPath);

const IDLE_STATUS = { running: false, port: 0, pid: null };

function createManagerStub() {
  return {
    start: vi.fn().mockResolvedValue({ running: true, port: 8080, pid: 123 }),
    stop: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({ running: true, port: 8080, pid: 123 }),
    syncInterfaceIssueScope: vi.fn().mockReturnValue({ running: true, port: 8080, pid: 123 }),
    proxyGet: vi.fn().mockResolvedValue({ ok: true }),
    proxyPost: vi.fn().mockResolvedValue({ ok: true }),
    proxyPut: vi.fn().mockResolvedValue({ ok: true }),
    proxyDelete: vi.fn().mockResolvedValue({ ok: true }),
    on: vi.fn(),
  };
}

describe('registerReticulumIpcHandlers', () => {
  const handlers = new Map<string, IpcHandler>();
  const event = {} as unknown;
  let manager: ReturnType<typeof createManagerStub>;
  let getManagerResult: ReturnType<typeof createManagerStub> | null;

  beforeEach(() => {
    handlers.clear();
    ipcMainHandleMock.mockReset().mockImplementation((channel: string, fn: IpcHandler) => {
      handlers.set(channel, fn);
    });
    assertIpcSenderMock.mockReset();
    memoAudioRateLimitMock.checkOrThrow.mockReset().mockImplementation(() => {});
    isAllowedNomadContentSourcePathMock
      .mockReset()
      .mockImplementation((path: string | null) => Boolean(path?.trim()));
    showRncpOpenFileDialogMock.mockReset();
    showRncpSaveDirectoryDialogMock.mockReset();
    isAllowedRncpSendFilePathMock.mockReset().mockReturnValue(false);
    isAllowedRncpSaveDirectoryPathMock.mockReset().mockReturnValue(false);
    isAllowedRncpRevealPathMock.mockReset().mockReturnValue(false);
    showItemInFolderMock.mockReset();
    manager = createManagerStub();
    getManagerResult = manager;

    registerReticulumIpcHandlers({
      idleStatus: IDLE_STATUS,
      ensureManager: () => manager as never,
      getManager: () => getManagerResult as never,
      getMainWindow: () => null,
    });
  });

  it('registers all expected reticulum:* handlers', () => {
    expect([...handlers.keys()]).toEqual(
      expect.arrayContaining([
        'reticulum:start',
        'reticulum:stop',
        'reticulum:getStatus',
        'reticulum:syncInterfaceIssueScope',
        'reticulum:proxyGet',
        'reticulum:proxyPost',
        'reticulum:voiceSendAudio',
        'reticulum:voiceMemoStart',
        'reticulum:voiceMemoSendAudio',
        'reticulum:voiceMemoStop',
        'reticulum:voiceMemoCancel',
        'reticulum:proxyPut',
        'reticulum:proxyDelete',
        'reticulum:readDefaultConfigFile',
        'reticulum:showConfigImportDialog',
        'reticulum:showIdentityImportDialog',
        'reticulum:showIdentityBackupImportDialog',
        'reticulum:saveIdentityExportDialog',
        'reticulum:saveBlocklistDialog',
        'reticulum:openBlocklistDialog',
        'reticulum:showNomadContentSourceDialog',
        'reticulum:setNomadContentSource',
        'reticulum:validateConfig',
        'reticulum:showRncpOpenFileDialog',
        'reticulum:showRncpSaveDirectoryDialog',
        'reticulum:revealInFolder',
        'reticulum:rncpSend',
        'reticulum:rncpFetch',
        'reticulum:setRncpListener',
      ]),
    );
  });

  describe('sender validation', () => {
    it('asserts sender on every handler before doing work', async () => {
      await handlers.get('reticulum:start')?.(event, {});
      await handlers.get('reticulum:stop')?.(event);
      handlers.get('reticulum:getStatus')?.(event);
      handlers.get('reticulum:syncInterfaceIssueScope')?.(event, []);
      await handlers.get('reticulum:proxyGet')?.(event, '/api/v1/x');
      await handlers.get('reticulum:proxyPost')?.(event, '/api/v1/x', {});
      await handlers.get('reticulum:voiceSendAudio')?.(event, {
        channels: 1,
        samples_b64: 'AAAA',
      });
      await handlers.get('reticulum:proxyPut')?.(event, '/api/v1/x', {});
      await handlers.get('reticulum:proxyDelete')?.(event, '/api/v1/x');
      handlers.get('reticulum:readDefaultConfigFile')?.(event);
      await handlers.get('reticulum:showConfigImportDialog')?.(event);
      await handlers.get('reticulum:showIdentityImportDialog')?.(event);
      await handlers.get('reticulum:showIdentityBackupImportDialog')?.(event);
      await handlers.get('reticulum:saveIdentityExportDialog')?.(event, {
        defaultPath: 'x.rsi',
        contentBase64: 'YQ==',
      });
      await handlers.get('reticulum:saveBlocklistDialog')?.(event, []);
      await handlers.get('reticulum:openBlocklistDialog')?.(event);
      await handlers.get('reticulum:showNomadContentSourceDialog')?.(event);
      await handlers.get('reticulum:setNomadContentSource')?.(event, '/tmp/site');
      await handlers.get('reticulum:validateConfig')?.(event);

      expect(assertIpcSenderMock).toHaveBeenCalledTimes(19);
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:saveBlocklistDialog');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:openBlocklistDialog');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:start');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:proxyPost');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:voiceSendAudio');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:setNomadContentSource');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:validateConfig');
    });

    it('saveBlocklistDialog rejects non-array payloads without opening a dialog', async () => {
      const { saveBlocklistToFile } = await import('../reticulum-blocklist-file');
      vi.mocked(saveBlocklistToFile).mockClear();

      const result = await handlers.get('reticulum:saveBlocklistDialog')?.(event, 'nope');

      expect(result).toEqual({ path: null, error: 'invalid_opts' });
      expect(saveBlocklistToFile).not.toHaveBeenCalled();
    });

    it('saveBlocklistDialog drops non-string entries before writing', async () => {
      const { saveBlocklistToFile } = await import('../reticulum-blocklist-file');
      vi.mocked(saveBlocklistToFile).mockClear();

      await handlers.get('reticulum:saveBlocklistDialog')?.(event, ['abc', 42, null]);

      expect(saveBlocklistToFile).toHaveBeenCalledWith(['abc']);
    });

    it('rejects unauthorized senders before ensureManager/getManager run', async () => {
      assertIpcSenderMock.mockImplementation(() => {
        throw new Error('reticulum:start: unauthorized sender');
      });
      const ensureManager = vi.fn(() => manager as never);
      registerReticulumIpcHandlers({
        idleStatus: IDLE_STATUS,
        ensureManager,
        getManager: () => manager as never,
        getMainWindow: () => null,
      });
      await expect(handlers.get('reticulum:start')?.(event, {})).rejects.toThrow(
        'unauthorized sender',
      );
      expect(ensureManager).not.toHaveBeenCalled();
    });
  });

  describe('reticulum:start / reticulum:stop', () => {
    it('start calls ensureManager().start with provided opts', async () => {
      const result = await handlers.get('reticulum:start')?.(event, { reuseIfRunning: true });
      expect(manager.start).toHaveBeenCalledWith({ reuseIfRunning: true });
      expect(result).toEqual({ running: true, port: 8080, pid: 123 });
    });

    it('start defaults opts to {} when omitted', async () => {
      await handlers.get('reticulum:start')?.(event, undefined);
      expect(manager.start).toHaveBeenCalledWith({});
    });

    it('start rethrows failures after logging', async () => {
      manager.start.mockRejectedValueOnce(new Error('boom'));
      await expect(handlers.get('reticulum:start')?.(event, {})).rejects.toThrow('boom');
    });

    it('stop no-ops when there is no manager yet', async () => {
      getManagerResult = null;
      await expect(handlers.get('reticulum:stop')?.(event)).resolves.toBeUndefined();
    });

    it('stop calls manager.stop() when a manager exists', async () => {
      await handlers.get('reticulum:stop')?.(event);
      expect(manager.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('reticulum:getStatus idle fallback', () => {
    it('returns manager status when a manager exists', () => {
      const result = handlers.get('reticulum:getStatus')?.(event);
      expect(result).toEqual({ running: true, port: 8080, pid: 123 });
    });

    it('falls back to idleStatus when there is no manager', () => {
      getManagerResult = null;
      const result = handlers.get('reticulum:getStatus')?.(event);
      expect(result).toBe(IDLE_STATUS);
    });
  });

  describe('reticulum:syncInterfaceIssueScope', () => {
    it('parses names and delegates to manager.syncInterfaceIssueScope', () => {
      const result = handlers.get('reticulum:syncInterfaceIssueScope')?.(event, [
        'TCP Hub',
        '  ',
        'Serial',
      ]);
      expect(manager.syncInterfaceIssueScope).toHaveBeenCalledWith(['TCP Hub', 'Serial']);
      expect(result).toEqual({ running: true, port: 8080, pid: 123 });
    });

    it('returns idleStatus when there is no manager', () => {
      getManagerResult = null;
      const result = handlers.get('reticulum:syncInterfaceIssueScope')?.(event, ['TCP']);
      expect(result).toBe(IDLE_STATUS);
    });

    it('throws on invalid payload shape', () => {
      expect(() =>
        handlers.get('reticulum:syncInterfaceIssueScope')?.(event, 'not-an-array'),
      ).toThrow('enabledInterfaceNames must be an array of strings');
    });
  });

  describe('reticulum:proxy* forwarding', () => {
    it('proxyGet forwards the path to manager.proxyGet', async () => {
      const result = await handlers.get('reticulum:proxyGet')?.(event, '/api/v1/diagnostics');
      expect(manager.proxyGet).toHaveBeenCalledWith('/api/v1/diagnostics');
      expect(result).toEqual({ ok: true });
    });

    it('proxyGet rejects non-string apiPath before calling ensureManager', async () => {
      const ensureManager = vi.fn(() => manager as never);
      registerReticulumIpcHandlers({
        idleStatus: IDLE_STATUS,
        ensureManager,
        getManager: () => manager as never,
        getMainWindow: () => null,
      });
      await expect(handlers.get('reticulum:proxyGet')?.(event, 42)).rejects.toThrow(
        'Reticulum proxy path must be a string',
      );
      expect(ensureManager).not.toHaveBeenCalled();
    });

    it('proxyGet returns a soft-failure envelope for expected sidecar-down races', async () => {
      manager.proxyGet.mockRejectedValueOnce(new Error('Reticulum sidecar is not running'));
      const result = await handlers.get('reticulum:proxyGet')?.(event, '/api/v1/diagnostics');
      expect(result).toEqual({
        __reticulumProxyError: true,
        message: 'Reticulum sidecar is not running',
      });
    });

    it('proxyGet rethrows unexpected manager failures', async () => {
      manager.proxyGet.mockRejectedValueOnce(new Error('EACCES permission denied'));
      await expect(
        handlers.get('reticulum:proxyGet')?.(event, '/api/v1/diagnostics'),
      ).rejects.toThrow('EACCES permission denied');
    });

    it.each([
      ['proxyPost', '/api/v1/lxmf/send', { text: 'hi' }] as const,
      ['proxyPut', '/api/v1/interfaces/tcp', { enabled: true }] as const,
      ['proxyDelete', '/api/v1/interfaces/tcp', undefined] as const,
    ])(
      '%s returns a soft-failure envelope for expected sidecar-down races',
      async (method, path, body) => {
        manager[method].mockRejectedValueOnce(new Error('Reticulum sidecar is not running'));
        const channel = `reticulum:${method}` as const;
        const result =
          body === undefined
            ? await handlers.get(channel)?.(event, path)
            : await handlers.get(channel)?.(event, path, body);
        expect(result).toEqual({
          __reticulumProxyError: true,
          message: 'Reticulum sidecar is not running',
        });
      },
    );

    it.each([
      ['proxyPost', '/api/v1/lxmf/send', { text: 'hi' }] as const,
      ['proxyPut', '/api/v1/interfaces/tcp', { enabled: true }] as const,
      ['proxyDelete', '/api/v1/interfaces/tcp', undefined] as const,
    ])('%s rethrows unexpected manager failures', async (method, path, body) => {
      manager[method].mockRejectedValueOnce(new Error('EACCES permission denied'));
      const channel = `reticulum:${method}` as const;
      const invoke =
        body === undefined
          ? handlers.get(channel)?.(event, path)
          : handlers.get(channel)?.(event, path, body);
      await expect(invoke).rejects.toThrow('EACCES permission denied');
    });

    it('proxyPost forwards path and body to manager.proxyPost', async () => {
      const body = { destination_hash: 'aa'.repeat(16), text: 'hi' };
      await handlers.get('reticulum:proxyPost')?.(event, '/api/v1/lxmf/send', body);
      expect(manager.proxyPost).toHaveBeenCalledWith('/api/v1/lxmf/send', body);
    });

    it('proxyPut forwards path and body to manager.proxyPut', async () => {
      const body = { enabled: true };
      await handlers.get('reticulum:proxyPut')?.(event, '/api/v1/interfaces/tcp', body);
      expect(manager.proxyPut).toHaveBeenCalledWith('/api/v1/interfaces/tcp', body);
    });

    it('proxyDelete forwards the path to manager.proxyDelete', async () => {
      await handlers.get('reticulum:proxyDelete')?.(event, '/api/v1/interfaces/tcp');
      expect(manager.proxyDelete).toHaveBeenCalledWith('/api/v1/interfaces/tcp');
    });
  });

  describe('config / identity import + validate', () => {
    it('readDefaultConfigFile delegates to readFirstExistingConfig', () => {
      readFirstExistingConfigMock.mockReturnValue({ path: '/tmp/x', content: 'y' });
      const result = handlers.get('reticulum:readDefaultConfigFile')?.(event);
      expect(result).toEqual({ path: '/tmp/x', content: 'y' });
    });

    it('showConfigImportDialog delegates to showReticulumConfigImportDialog', async () => {
      showReticulumConfigImportDialogMock.mockResolvedValue({
        canceled: false,
        path: '/tmp/x',
        content: 'y',
      } as never);
      const result = await handlers.get('reticulum:showConfigImportDialog')?.(event);
      expect(result).toEqual({ canceled: false, path: '/tmp/x', content: 'y' });
    });

    it('showIdentityImportDialog delegates to showReticulumIdentityImportDialog', async () => {
      showReticulumIdentityImportDialogMock.mockResolvedValue({ canceled: true } as never);
      const result = await handlers.get('reticulum:showIdentityImportDialog')?.(event);
      expect(result).toEqual({ canceled: true });
    });

    it('showNomadContentSourceDialog delegates to showNomadContentSourceDialog', async () => {
      showNomadContentSourceDialogMock.mockResolvedValue({
        canceled: false,
        path: '/tmp/nomad-page',
      });
      const result = await handlers.get('reticulum:showNomadContentSourceDialog')?.(event);
      expect(result).toEqual({ canceled: false, path: '/tmp/nomad-page' });
    });

    it('setNomadContentSource rejects empty paths', async () => {
      const result = await handlers.get('reticulum:setNomadContentSource')?.(event, '   ');
      expect(result).toEqual({ ok: false, error: 'content_source_required' });
      expect(manager.proxyPut).not.toHaveBeenCalled();
    });

    it('setNomadContentSource throws TypeError for non-string paths', async () => {
      await expect(handlers.get('reticulum:setNomadContentSource')?.(event, 42)).rejects.toThrow(
        TypeError,
      );
      await expect(handlers.get('reticulum:setNomadContentSource')?.(event, null)).rejects.toThrow(
        /must be a string/,
      );
      expect(manager.proxyPut).not.toHaveBeenCalled();
    });

    it('setNomadContentSource rejects paths not from the folder picker', async () => {
      isAllowedNomadContentSourcePathMock.mockReturnValue(false);
      const result = await handlers.get('reticulum:setNomadContentSource')?.(event, '/evil/path');
      expect(result).toEqual({ ok: false, error: 'content_source_not_from_picker' });
      expect(manager.proxyPut).not.toHaveBeenCalled();
    });

    it('setNomadContentSource applies picker-backed paths via sidecar', async () => {
      isAllowedNomadContentSourcePathMock.mockReturnValue(true);
      manager.proxyPut.mockResolvedValueOnce({
        ok: true,
        serving: { content_source: '/tmp/site' },
      });
      const result = await handlers.get('reticulum:setNomadContentSource')?.(event, '/tmp/site');
      expect(manager.proxyPut).toHaveBeenCalledWith('/api/v1/nomadnetwork/serving/content-source', {
        path: '/tmp/site',
      });
      expect(result).toEqual({ ok: true, serving: { content_source: '/tmp/site' } });
    });

    it('proxyPut rejects Nomad content-source mutations', async () => {
      await expect(
        handlers.get('reticulum:proxyPut')?.(event, '/api/v1/nomadnetwork/serving/content-source', {
          path: '/tmp/x',
        }),
      ).rejects.toThrow(/setNomadContentSource/);
      expect(manager.proxyPut).not.toHaveBeenCalled();
    });

    it('validateConfig returns the validator result on success', async () => {
      validateReticulumUserConfigMock.mockResolvedValue({ ok: true, issues: [] });
      const result = await handlers.get('reticulum:validateConfig')?.(event);
      expect(result).toEqual({ ok: true, issues: [] });
    });

    it('validateConfig catches failures and returns a soft error result', async () => {
      validateReticulumUserConfigMock.mockRejectedValue(new Error('config unreadable'));
      const result = await handlers.get('reticulum:validateConfig')?.(event);
      expect(result).toEqual({ ok: false, issues: [], error: 'config unreadable' });
    });
  });

  describe('rncp file dialogs + picker-gated send/fetch/listener', () => {
    it('showRncpOpenFileDialog delegates to showRncpOpenFileDialog', async () => {
      showRncpOpenFileDialogMock.mockResolvedValue({ canceled: false, path: '/tmp/send.txt' });
      const result = await handlers.get('reticulum:showRncpOpenFileDialog')?.(event);
      expect(result).toEqual({ canceled: false, path: '/tmp/send.txt' });
    });

    it('showRncpSaveDirectoryDialog delegates to showRncpSaveDirectoryDialog', async () => {
      showRncpSaveDirectoryDialogMock.mockResolvedValue({ canceled: false, path: '/tmp/recv' });
      const result = await handlers.get('reticulum:showRncpSaveDirectoryDialog')?.(event);
      expect(result).toEqual({ canceled: false, path: '/tmp/recv' });
    });

    it('revealInFolder rejects paths not from a prior picker result', () => {
      isAllowedRncpRevealPathMock.mockReturnValue(false);
      const result = handlers.get('reticulum:revealInFolder')?.(event, '/etc/passwd');
      expect(result).toEqual({ ok: false, error: 'path_not_from_picker' });
      expect(showItemInFolderMock).not.toHaveBeenCalled();
    });

    it('revealInFolder shows picker-backed paths', () => {
      isAllowedRncpRevealPathMock.mockReturnValue(true);
      const result = handlers.get('reticulum:revealInFolder')?.(event, '/tmp/send.txt');
      expect(result).toEqual({ ok: true });
      expect(showItemInFolderMock).toHaveBeenCalledWith('/tmp/send.txt');
    });

    it('rncpSend rejects a path not from the file picker', async () => {
      isAllowedRncpSendFilePathMock.mockReturnValue(false);
      const result = await handlers.get('reticulum:rncpSend')?.(event, {
        destination_hash: 'aa'.repeat(16),
        path: '/etc/passwd',
      });
      expect(result).toEqual({ ok: false, error: 'path_not_from_picker' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('rncpSend forwards picker-backed paths to the sidecar', async () => {
      isAllowedRncpSendFilePathMock.mockReturnValue(true);
      await handlers.get('reticulum:rncpSend')?.(event, {
        destination_hash: 'aa'.repeat(16),
        path: '/tmp/send.txt',
      });
      expect(manager.proxyPost).toHaveBeenCalledWith('/api/v1/rncp/send', {
        destination_hash: 'aa'.repeat(16),
        path: '/tmp/send.txt',
      });
    });

    it('rncpFetch allows an omitted save_path (sidecar default)', async () => {
      await handlers.get('reticulum:rncpFetch')?.(event, {
        destination_hash: 'aa'.repeat(16),
        remote_path: '/remote/file.txt',
      });
      expect(manager.proxyPost).toHaveBeenCalledWith('/api/v1/rncp/fetch', {
        destination_hash: 'aa'.repeat(16),
        remote_path: '/remote/file.txt',
        save_path: undefined,
      });
    });

    it('rncpFetch rejects a save_path not under the picked save directory', async () => {
      isAllowedRncpSaveDirectoryPathMock.mockReturnValue(false);
      const result = await handlers.get('reticulum:rncpFetch')?.(event, {
        destination_hash: 'aa'.repeat(16),
        remote_path: '/remote/file.txt',
        save_path: '/etc/evil.txt',
      });
      expect(result).toEqual({ ok: false, error: 'save_path_not_from_picker' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('setRncpListener rejects enabled without save_dir', async () => {
      const result = await handlers.get('reticulum:setRncpListener')?.(event, {
        enabled: true,
      });
      expect(result).toEqual({ ok: false, error: 'save_dir_required' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('setRncpListener rejects allow_fetch without fetch_jail', async () => {
      isAllowedRncpSaveDirectoryPathMock.mockReturnValue(true);
      const result = await handlers.get('reticulum:setRncpListener')?.(event, {
        enabled: true,
        save_dir: '/tmp/recv',
        allow_fetch: true,
      });
      expect(result).toEqual({ ok: false, error: 'fetch_jail_required' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('setRncpListener rejects a save_dir not from the folder picker', async () => {
      isAllowedRncpSaveDirectoryPathMock.mockReturnValue(false);
      const result = await handlers.get('reticulum:setRncpListener')?.(event, {
        enabled: true,
        save_dir: '/etc',
      });
      expect(result).toEqual({ ok: false, error: 'save_dir_not_from_picker' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('setRncpListener rejects a fetch_jail not from the folder picker', async () => {
      isAllowedRncpSaveDirectoryPathMock.mockImplementation((p) => p === '/tmp/recv');
      const result = await handlers.get('reticulum:setRncpListener')?.(event, {
        enabled: true,
        save_dir: '/tmp/recv',
        fetch_jail: '/etc',
      });
      expect(result).toEqual({ ok: false, error: 'fetch_jail_not_from_picker' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('setRncpListener forwards picker-backed dirs and policy lists to the sidecar', async () => {
      isAllowedRncpSaveDirectoryPathMock.mockReturnValue(true);
      await handlers.get('reticulum:setRncpListener')?.(event, {
        enabled: true,
        save_dir: '/tmp/recv',
        allow_fetch: true,
        fetch_jail: '/tmp/recv',
        overwrite: true,
        allowed: ['aa'.repeat(16)],
        blocked: ['bb'.repeat(16)],
      });
      expect(manager.proxyPost).toHaveBeenCalledWith('/api/v1/rncp/listener', {
        enabled: true,
        save_dir: '/tmp/recv',
        allow_fetch: true,
        fetch_jail: '/tmp/recv',
        overwrite: true,
        allowed: ['aa'.repeat(16)],
        blocked: ['bb'.repeat(16)],
      });
    });

    it('proxyPost rejects picker-gated rncp mutation paths', async () => {
      await expect(
        handlers.get('reticulum:proxyPost')?.(event, '/api/v1/rncp/send', { path: '/tmp/x' }),
      ).rejects.toThrow(/rncpSend\/rncpFetch\/setRncpListener/);
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('proxyPost rejects voice PCM path; voiceSendAudio forwards validated frames', async () => {
      await expect(
        handlers.get('reticulum:proxyPost')?.(event, '/api/v1/voice/audio', {
          channels: 1,
          samples_b64: 'AAAA',
        }),
      ).rejects.toThrow(/voiceSendAudio/);
      expect(manager.proxyPost).not.toHaveBeenCalled();

      const ok = await handlers.get('reticulum:voiceSendAudio')?.(event, {
        channels: 1,
        samples_b64: 'AAAA',
        profile: 0x50,
      });
      expect(ok).toEqual({ ok: true });
      expect(manager.proxyPost).toHaveBeenCalledWith('/api/v1/voice/audio', {
        channels: 1,
        samples_b64: 'AAAA',
        profile: 0x50,
      });

      const bad = await handlers.get('reticulum:voiceSendAudio')?.(event, {
        channels: 1,
        samples_b64: '',
      });
      expect(bad).toEqual({ ok: false, error: 'empty_samples_b64' });
    });
  });

  describe('voice memo IPC', () => {
    it('proxyPost rejects memo paths including query strings', async () => {
      await expect(
        handlers.get('reticulum:proxyPost')?.(event, `${VOICE_MEMO_START_API_PATH}?foo=1`, {}),
      ).rejects.toThrow(/voiceMemo\* IPC channels/);
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('voiceMemoStart forwards body to sidecar', async () => {
      const body = { destination_hash: 'aa'.repeat(16) };
      const ok = await handlers.get('reticulum:voiceMemoStart')?.(event, body);
      expect(ok).toEqual({ ok: true });
      expect(manager.proxyPost).toHaveBeenCalledWith(VOICE_MEMO_START_API_PATH, body);
    });

    it('voiceMemoStart defaults invalid opts to {}', async () => {
      await handlers.get('reticulum:voiceMemoStart')?.(event, null);
      expect(manager.proxyPost).toHaveBeenCalledWith(VOICE_MEMO_START_API_PATH, {});
    });

    it('voiceMemoSendAudio forwards validated frames', async () => {
      const ok = await handlers.get('reticulum:voiceMemoSendAudio')?.(event, {
        session_id: 'sess-1',
        channels: 1,
        samples_b64: 'AAAA',
      });
      expect(ok).toEqual({ ok: true });
      expect(manager.proxyPost).toHaveBeenCalledWith(VOICE_MEMO_AUDIO_API_PATH, {
        session_id: 'sess-1',
        channels: 1,
        samples_b64: 'AAAA',
      });
      expect(memoAudioRateLimitMock.checkOrThrow).toHaveBeenCalled();
    });

    it('voiceMemoSendAudio rejects invalid payload', async () => {
      const bad = await handlers.get('reticulum:voiceMemoSendAudio')?.(event, {
        session_id: 'sess-1',
        channels: 1,
        samples_b64: '',
      });
      expect(bad).toEqual({ ok: false, error: 'empty_samples_b64' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('voiceMemoSendAudio throws when dedicated rate limit is exceeded', async () => {
      memoAudioRateLimitMock.checkOrThrow.mockImplementationOnce(() => {
        throw new Error('reticulum:voiceMemoSendAudio: rate limit exceeded');
      });
      await expect(
        handlers.get('reticulum:voiceMemoSendAudio')?.(event, {
          session_id: 'sess-1',
          channels: 1,
          samples_b64: 'AAAA',
        }),
      ).rejects.toThrow(/rate limit exceeded/);
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('voiceMemoStop forwards session and caps oversized ogg_base64', async () => {
      manager.proxyPost.mockResolvedValueOnce({
        ok: true,
        ogg_base64: 'x'.repeat(VOICE_MEMO_DATA_BASE64_MAX + 1),
      });
      const tooLarge = await handlers.get('reticulum:voiceMemoStop')?.(event, {
        session_id: 'sess-1',
      });
      expect(tooLarge).toEqual({ ok: false, error: 'ogg_base64_too_large' });

      manager.proxyPost.mockResolvedValueOnce({
        ok: true,
        ogg_base64: 'YQ==',
        duration_ms: 1000,
      });
      const ok = await handlers.get('reticulum:voiceMemoStop')?.(event, {
        session_id: 'sess-1',
      });
      expect(ok).toEqual({ ok: true, ogg_base64: 'YQ==', duration_ms: 1000 });
      expect(manager.proxyPost).toHaveBeenCalledWith(VOICE_MEMO_STOP_API_PATH, {
        session_id: 'sess-1',
      });
    });

    it('voiceMemoStop rejects invalid session request', async () => {
      const bad = await handlers.get('reticulum:voiceMemoStop')?.(event, {});
      expect(bad).toEqual({ ok: false, error: 'invalid_session_id' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('voiceMemoCancel forwards validated session request', async () => {
      const ok = await handlers.get('reticulum:voiceMemoCancel')?.(event, {
        session_id: 'sess-1',
      });
      expect(ok).toEqual({ ok: true });
      expect(manager.proxyPost).toHaveBeenCalledWith(VOICE_MEMO_CANCEL_API_PATH, {
        session_id: 'sess-1',
      });
    });

    it('voiceMemoCancel rejects invalid session request', async () => {
      const bad = await handlers.get('reticulum:voiceMemoCancel')?.(event, { session_id: '' });
      expect(bad).toEqual({ ok: false, error: 'invalid_session_id' });
      expect(manager.proxyPost).not.toHaveBeenCalled();
    });

    it('rejects unauthorized senders before ensureManager runs', async () => {
      assertIpcSenderMock.mockImplementation(() => {
        throw new Error('reticulum:voiceMemoStart: unauthorized sender');
      });
      const ensureManager = vi.fn(() => manager as never);
      registerReticulumIpcHandlers({
        idleStatus: IDLE_STATUS,
        ensureManager,
        getManager: () => manager as never,
        getMainWindow: () => null,
      });
      await expect(
        handlers.get('reticulum:voiceMemoStart')?.(event, { destination_hash: 'aa'.repeat(16) }),
      ).rejects.toThrow('unauthorized sender');
      await expect(
        handlers.get('reticulum:voiceMemoSendAudio')?.(event, {
          session_id: 'sess-1',
          channels: 1,
          samples_b64: 'AAAA',
        }),
      ).rejects.toThrow('unauthorized sender');
      await expect(
        handlers.get('reticulum:voiceMemoStop')?.(event, { session_id: 'sess-1' }),
      ).rejects.toThrow('unauthorized sender');
      await expect(
        handlers.get('reticulum:voiceMemoCancel')?.(event, { session_id: 'sess-1' }),
      ).rejects.toThrow('unauthorized sender');
      expect(ensureManager).not.toHaveBeenCalled();
    });
  });
});

describe('wireReticulumSidecarBridge', () => {
  function createWinStub(destroyed = false) {
    return {
      isDestroyed: () => destroyed,
      webContents: { send: vi.fn() },
    };
  }

  it('forwards manager "event" emissions to the main window', () => {
    const manager = createManagerStub();
    const win = createWinStub();
    wireReticulumSidecarBridge(manager as never, () => win as unknown as BrowserWindow);

    const eventHandler = manager.on.mock.calls.find((call) => call[0] === 'event')?.[1] as (
      evt: unknown,
    ) => void;
    expect(eventHandler).toBeTypeOf('function');
    eventHandler({ type: 'wire_packet', payload: {} });
    expect(win.webContents.send).toHaveBeenCalledWith('reticulum:event', {
      type: 'wire_packet',
      payload: {},
    });
  });

  it('forwards manager "voiceAudio" emissions to reticulum:voiceAudio', () => {
    const manager = createManagerStub();
    const win = createWinStub();
    wireReticulumSidecarBridge(manager as never, () => win as unknown as BrowserWindow);

    const voiceHandler = manager.on.mock.calls.find((call) => call[0] === 'voiceAudio')?.[1] as (
      evt: unknown,
    ) => void;
    expect(voiceHandler).toBeTypeOf('function');
    voiceHandler({ type: 'voice.audio', payload: { channels: 1, samples_b64: 'AAAA' } });
    expect(win.webContents.send).toHaveBeenCalledWith('reticulum:voiceAudio', {
      type: 'voice.audio',
      payload: { channels: 1, samples_b64: 'AAAA' },
    });
  });

  it('forwards manager "status" emissions to the main window', () => {
    const manager = createManagerStub();
    const win = createWinStub();
    wireReticulumSidecarBridge(manager as never, () => win as unknown as BrowserWindow);

    const statusHandler = manager.on.mock.calls.find((call) => call[0] === 'status')?.[1] as (
      status: unknown,
    ) => void;
    statusHandler({ running: true, port: 8080, pid: 1 });
    expect(win.webContents.send).toHaveBeenCalledWith('reticulum:status', {
      running: true,
      port: 8080,
      pid: 1,
    });
  });

  it('does not send when there is no main window', () => {
    const manager = createManagerStub();
    wireReticulumSidecarBridge(manager as never, () => null);

    const eventHandler = manager.on.mock.calls.find((call) => call[0] === 'event')?.[1] as (
      evt: unknown,
    ) => void;
    expect(() => {
      eventHandler({ type: 'wire_packet', payload: {} });
    }).not.toThrow();
  });

  it('does not send when the main window is destroyed', () => {
    const manager = createManagerStub();
    const win = createWinStub(true);
    wireReticulumSidecarBridge(manager as never, () => win as unknown as BrowserWindow);

    const statusHandler = manager.on.mock.calls.find((call) => call[0] === 'status')?.[1] as (
      status: unknown,
    ) => void;
    statusHandler({ running: false, port: 0, pid: null });
    expect(win.webContents.send).not.toHaveBeenCalled();
  });
});
