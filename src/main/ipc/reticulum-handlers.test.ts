// @vitest-environment node
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { ipcMainHandleMock } = vi.hoisted(() => ({
  ipcMainHandleMock: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: ipcMainHandleMock },
}));

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
  isAllowedNomadContentSourcePath: vi.fn((path: string | null) => path == null || path === ''),
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
}));

import {
  isAllowedNomadContentSourcePath,
  readFirstExistingConfig,
  showNomadContentSourceDialog,
  showReticulumConfigImportDialog,
} from '../reticulum-config-paths';
import { validateReticulumUserConfig } from '../reticulum-config-validate';
import { showReticulumIdentityImportDialog } from '../reticulum-identity-import';
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
    isAllowedNomadContentSourcePathMock
      .mockReset()
      .mockImplementation((path: string | null) => path == null || path === '');
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
        'reticulum:proxyPut',
        'reticulum:proxyDelete',
        'reticulum:readDefaultConfigFile',
        'reticulum:showConfigImportDialog',
        'reticulum:showIdentityImportDialog',
        'reticulum:showNomadContentSourceDialog',
        'reticulum:setNomadContentSource',
        'reticulum:validateConfig',
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
      await handlers.get('reticulum:proxyPut')?.(event, '/api/v1/x', {});
      await handlers.get('reticulum:proxyDelete')?.(event, '/api/v1/x');
      handlers.get('reticulum:readDefaultConfigFile')?.(event);
      await handlers.get('reticulum:showConfigImportDialog')?.(event);
      await handlers.get('reticulum:showIdentityImportDialog')?.(event);
      await handlers.get('reticulum:showNomadContentSourceDialog')?.(event);
      await handlers.get('reticulum:setNomadContentSource')?.(event, null);
      await handlers.get('reticulum:validateConfig')?.(event);

      expect(assertIpcSenderMock).toHaveBeenCalledTimes(14);
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:start');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:proxyPost');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:setNomadContentSource');
      expect(assertIpcSenderMock).toHaveBeenCalledWith(event, 'reticulum:validateConfig');
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

    it('proxyGet rethrows failures from the manager', async () => {
      manager.proxyGet.mockRejectedValueOnce(new Error('sidecar not running'));
      await expect(
        handlers.get('reticulum:proxyGet')?.(event, '/api/v1/diagnostics'),
      ).rejects.toThrow('sidecar not running');
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
