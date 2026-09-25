// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { fromWebContents: vi.fn(() => ({})) },
}));

vi.mock('../validate-ipc-sender', () => ({
  assertIpcSender: vi.fn(),
}));

vi.mock('../tak/remote-credentials', () => ({
  TAK_CREDENTIAL_FILE_MAX_BYTES: 64,
  TAK_CREDENTIAL_FILES_MAX: 2,
  parseTakCredentialFiles: vi.fn(() => ({ ca: 'ca-pem', cert: 'cert-pem', key: 'key-pem' })),
  saveTakRemoteCredentials: vi.fn(),
  loadTakRemoteCredentials: vi.fn(() => ({ ca: 'ca-pem', cert: 'cert-pem', key: 'key-pem' })),
  summarizeTakRemoteCredentials: vi.fn(() => ({
    caSubjects: ['Test CA'],
    clientSubject: 'atak-user',
  })),
  clearTakRemoteCredentials: vi.fn(),
}));

vi.mock('../tak/remote-settings', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadTakRemoteSettings: vi.fn(() => null),
}));

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dialog } from 'electron';

import { parseTakCredentialFiles, saveTakRemoteCredentials } from '../tak/remote-credentials';
import { assertIpcSender } from '../validate-ipc-sender';
import { registerTakIpcHandlers } from './tak-handlers';

describe('tak-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers tak channels with assertIpcSender', async () => {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    const stop = vi.fn();
    registerTakIpcHandlers({
      idleTakStatus: { status: 'disconnected' } as never,
      ensureTakServerManager: vi.fn(),
      getTakServerManager: () => ({ stop }) as never,
      validateTakSettings: vi.fn(),
    });

    const channels = handle.mock.calls.map((c) => c[0]);
    expect(channels).toEqual(
      expect.arrayContaining([
        'tak:start',
        'tak:stop',
        'tak:getStatus',
        'tak:getConnectedClients',
        'tak:generateDataPackage',
        'tak:regenerateCertificates',
        'tak:pushNodeUpdate',
      ]),
    );

    const stopHandler = handle.mock.calls.find((c) => c[0] === 'tak:stop')?.[1] as (
      event: unknown,
    ) => void;
    const event = {};
    stopHandler(event);
    expect(assertIpcSender).toHaveBeenCalledWith(event, 'tak:stop');
    expect(stop).toHaveBeenCalled();
  });
});

describe('tak:pushNodeUpdates', () => {
  type BatchHandler = (event: unknown, nodes: unknown) => void;

  async function registerWith(manager: unknown): Promise<BatchHandler> {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    handle.mockClear();
    registerTakIpcHandlers({
      idleTakStatus: { running: false, port: 8089, clientCount: 0 },
      ensureTakServerManager: vi.fn(),
      getTakServerManager: () => manager as never,
      validateTakSettings: vi.fn(),
    });
    return handle.mock.calls.find((c) => c[0] === 'tak:pushNodeUpdates')?.[1] as BatchHandler;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('forwards valid updates and drops invalid ones', async () => {
    const onNodeUpdate = vi.fn();
    const handler = await registerWith({ hasActiveSink: () => true, onNodeUpdate });
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

    handler({}, [
      { node_id: 1, protocol: 'meshcore', latitude: 40, longitude: -105 },
      { node_id: -1 },
      { node_id: 2, protocol: 'reticulum', latitude: 41, longitude: -104 },
    ]);

    expect(assertIpcSender).toHaveBeenCalledWith({}, 'tak:pushNodeUpdates');
    expect(onNodeUpdate.mock.calls.map((c) => (c[0] as { node_id: number }).node_id)).toEqual([
      1, 2,
    ]);
    expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('dropped 1 invalid'));
    debugSpy.mockRestore();
  });

  it('skips the batch when no sink is active', async () => {
    const onNodeUpdate = vi.fn();
    const handler = await registerWith({ hasActiveSink: () => false, onNodeUpdate });
    handler({}, [{ node_id: 1, latitude: 40, longitude: -105 }]);
    expect(onNodeUpdate).not.toHaveBeenCalled();
  });

  it('skips the batch when the TAK module has not been loaded', async () => {
    const handler = await registerWith(null);
    expect(() => {
      handler({}, [{ node_id: 1 }]);
    }).not.toThrow();
  });

  it.each([
    ['a non-array', { node_id: 1 }],
    ['an oversized batch', Array.from({ length: 501 }, (_, i) => ({ node_id: i + 1 }))],
  ])('rejects %s', async (_label, nodes) => {
    const handler = await registerWith({ hasActiveSink: () => true, onNodeUpdate: vi.fn() });
    expect(() => {
      handler({}, nodes);
    }).toThrow(/at most 500/);
  });
});

describe('remote relay handlers', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;

  async function register(manager: unknown = null) {
    const { ipcMain } = await import('electron');
    const handle = vi.mocked(ipcMain.handle);
    handle.mockClear();
    const ensure = vi.fn().mockResolvedValue(manager);
    registerTakIpcHandlers({
      idleTakStatus: { running: false, port: 8089, clientCount: 0 },
      ensureTakServerManager: ensure,
      getTakServerManager: () => manager as never,
      validateTakSettings: vi.fn(),
    });
    const get = (channel: string) =>
      handle.mock.calls.find((c) => c[0] === channel)?.[1] as Handler;
    return { get, ensure };
  }

  const event = { sender: {} };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('validates settings before starting the relay', async () => {
    const startRemote = vi.fn();
    const { get } = await register({ startRemote });
    await expect(get('tak:remoteStart')(event, { host: '', port: 8089 })).rejects.toThrow(/host/);
    expect(startRemote).not.toHaveBeenCalled();

    const settings = {
      host: 'tak.example.org',
      port: 8089,
      verifyServer: true,
      allowNameMismatch: false,
      autoConnect: false,
    };
    await get('tak:remoteStart')(event, settings);
    expect(startRemote).toHaveBeenCalledWith(settings);
  });

  it('stops a running relay before clearing its credentials', async () => {
    const stopRemote = vi.fn();
    const { get } = await register({ stopRemote });
    get('tak:remoteClearCredentials')(event);
    expect(stopRemote).toHaveBeenCalled();
  });

  it('reports an idle relay before the TAK module loads', async () => {
    const { get } = await register(null);
    expect(get('tak:remoteGetStatus')(event)).toEqual({
      state: 'disconnected',
      host: '',
      port: 8089,
    });
    expect(() => get('tak:remoteStop')(event)).not.toThrow();
  });

  describe('tak:remoteImportCredentials', () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-tak-import-'));
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    function tempFile(name: string, bytes: number): string {
      const file = path.join(dir, name);
      fs.writeFileSync(file, Buffer.alloc(bytes, 1));
      return file;
    }

    it('returns null when the chooser is cancelled', async () => {
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: true, filePaths: [] });
      const { get } = await register();
      await expect(get('tak:remoteImportCredentials')(event)).resolves.toBeNull();
      expect(saveTakRemoteCredentials).not.toHaveBeenCalled();
    });

    it('parses, stores, and returns only a summary', async () => {
      const file = tempFile('user.p12', 10);
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [file],
      });
      const restartRemote = vi.fn();
      const { get } = await register({ restartRemote });

      const summary = await get('tak:remoteImportCredentials')(event, 'atakatak');

      expect(vi.mocked(parseTakCredentialFiles).mock.calls[0]?.[1]).toBe('atakatak');
      expect(vi.mocked(parseTakCredentialFiles).mock.calls[0]?.[0][0]?.data).toEqual(
        Buffer.alloc(10, 1),
      );
      expect(saveTakRemoteCredentials).toHaveBeenCalledWith({
        ca: 'ca-pem',
        cert: 'cert-pem',
        key: 'key-pem',
      });
      expect(summary).toEqual({ caSubjects: ['Test CA'], clientSubject: 'atak-user' });
      expect(JSON.stringify(summary)).not.toContain('key-pem');
      expect(restartRemote).toHaveBeenCalled();
    });

    it('rejects a non-string password before opening the chooser', async () => {
      const { get } = await register();
      await expect(get('tak:remoteImportCredentials')(event, 42)).rejects.toThrow(/password/);
      expect(dialog.showOpenDialog).not.toHaveBeenCalled();
    });

    it('rejects too many files, oversized files, and anything that is not a file', async () => {
      const { get } = await register();
      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [tempFile('a.pem', 1), tempFile('b.pem', 1), tempFile('c.pem', 1)],
      });
      await expect(get('tak:remoteImportCredentials')(event)).rejects.toThrow(/at most 2/);

      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [tempFile('huge.p12', 65)],
      });
      await expect(get('tak:remoteImportCredentials')(event)).rejects.toThrow(/too large/);

      vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
        canceled: false,
        filePaths: [dir],
      });
      await expect(get('tak:remoteImportCredentials')(event)).rejects.toThrow(/not a regular file/);
      expect(saveTakRemoteCredentials).not.toHaveBeenCalled();
    });

    // OS-specific: named pipes via mkfifo exist on POSIX only.
    it.skipIf(process.platform === 'win32')(
      'rejects a FIFO without waiting for a writer',
      async () => {
        const fifo = path.join(dir, 'pipe.p12');
        execFileSync('mkfifo', [fifo]);
        vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({
          canceled: false,
          filePaths: [fifo],
        });
        const { get } = await register();
        await expect(get('tak:remoteImportCredentials')(event)).rejects.toThrow(
          /not a regular file/,
        );
      },
    );
  });
});
