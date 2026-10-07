// @vitest-environment node
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  detectSystemReticulum,
  parseSystemReticulumConfig,
  resolveSharedInstanceType,
} from './reticulum-system-instance';

describe('parseSystemReticulumConfig', () => {
  it('defaults share_instance to true like Python RNS when absent', () => {
    const parsed = parseSystemReticulumConfig('[reticulum]\nenable_transport = No\n');
    expect(parsed.shareInstance).toBe(true);
    expect(parsed.sharedInstancePort).toBe(37428);
    expect(parsed.instanceName).toBe('default');
    expect(parsed.sharedInstanceType).toBeNull();
  });

  it('ignores commented keys and keys outside [reticulum]', () => {
    const parsed = parseSystemReticulumConfig(
      [
        '[reticulum]',
        '# share_instance = No',
        '  share_instance = yes # inline comment',
        'shared_instance_port = 40000',
        'instance_name = lab',
        'shared_instance_type = TCP',
        '[logging]',
        'shared_instance_port = 1',
      ].join('\n'),
    );
    expect(parsed.shareInstance).toBe(true);
    expect(parsed.sharedInstancePort).toBe(40000);
    expect(parsed.instanceName).toBe('lab');
    expect(parsed.sharedInstanceType).toBe('tcp');
  });

  it.each(['No', 'false', 'off', '0'])('parses share_instance = %s as off', (value) => {
    expect(
      parseSystemReticulumConfig(`[reticulum]\nshare_instance = ${value}\n`).shareInstance,
    ).toBe(false);
  });

  it('collects enabled serial RNode / KISS ports only', () => {
    const parsed = parseSystemReticulumConfig(
      [
        '[reticulum]',
        '[interfaces]',
        '  [[RNode LoRa]]',
        '    type = RNodeInterface',
        '    enabled = yes',
        '    port = /dev/ttyUSB0',
        '  [[Disabled RNode]]',
        '    type = RNodeInterface',
        '    interface_enabled = No',
        '    port = /dev/ttyUSB1',
        '  [[TCP]]',
        '    type = TCPClientInterface',
        '    enabled = yes',
        '    target_port = 4242',
        '  [[Packet]]',
        '    type = KISSInterface',
        '    enabled = yes',
        '    port = COM3',
      ].join('\n'),
    );
    expect(parsed.serialPorts).toEqual(['/dev/ttyUSB0', 'COM3']);
  });
});

describe('resolveSharedInstanceType', () => {
  it.each([
    ['linux', null, 'unix'],
    ['linux', 'tcp', 'tcp'],
    ['darwin', null, 'tcp'],
    ['darwin', 'unix', 'tcp'],
    ['win32', null, 'tcp'],
  ] as const)('%s with configured %s resolves to %s', (platform, configured, expected) => {
    expect(resolveSharedInstanceType(configured, platform)).toBe(expected);
  });
});

describe('detectSystemReticulum', () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-system-rns-'));
    vi.spyOn(os, 'homedir').mockReturnValue(home);
    const realExists = fs.existsSync.bind(fs);
    vi.spyOn(fs, 'existsSync').mockImplementation((p) =>
      String(p).startsWith('/etc/') ? false : realExists(p),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(home, { recursive: true, force: true });
  });

  function writeHomeConfig(content: string): string {
    const dir = path.join(home, '.reticulum');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'config');
    fs.writeFileSync(file, content);
    return file;
  }

  it.each(['linux', 'darwin', 'win32'] as const)(
    '%s: probes the platform shared endpoint and never writes the config',
    async (platform) => {
      const file =
        platform === 'win32' ? null : writeHomeConfig('[reticulum]\nshare_instance = Yes\n');
      const before = file ? fs.readFileSync(file, 'utf8') : null;
      const connect = vi.fn().mockResolvedValue(true);
      const result = await detectSystemReticulum(platform, connect);
      expect(result.running).toBe(true);
      if (platform === 'linux') {
        expect(result.sharedInstanceType).toBe('unix');
        expect(result.endpoint).toBe('rns/default');
        expect(connect).toHaveBeenCalledWith({ path: '\0rns/default' });
      } else {
        expect(result.sharedInstanceType).toBe('tcp');
        expect(result.endpoint).toBe('127.0.0.1:37428');
        expect(connect).toHaveBeenCalledWith({ host: '127.0.0.1', port: 37428 });
      }
      if (file) {
        expect(result.configPath).toBe(file);
        expect(fs.readFileSync(file, 'utf8')).toBe(before);
      }
    },
  );

  it.each(['linux', 'darwin', 'win32'] as const)(
    '%s: share_instance off skips the probe',
    async (platform) => {
      if (platform !== 'win32') writeHomeConfig('[reticulum]\nshare_instance = No\n');
      const connect = vi.fn().mockResolvedValue(true);
      const result = await detectSystemReticulum(platform, connect);
      if (platform === 'win32') {
        expect(connect).toHaveBeenCalled();
      } else {
        expect(result.running).toBe(false);
        expect(connect).not.toHaveBeenCalled();
      }
    },
  );

  it('detects a live TCP listener on the configured port', async () => {
    const server = net.createServer((s) => s.destroy());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    writeHomeConfig(`[reticulum]\nshared_instance_port = ${port}\n`);
    try {
      const up = await detectSystemReticulum('darwin');
      expect(up.running).toBe(true);
      expect(up.endpoint).toBe(`127.0.0.1:${port}`);
    } finally {
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    }
    const down = await detectSystemReticulum('darwin');
    expect(down.running).toBe(false);
  });
});
