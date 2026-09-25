// @vitest-environment node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-tak-remote-settings-'));

vi.mock('electron', () => ({
  app: { getPath: () => userData },
}));

import {
  loadTakRemoteSettings,
  saveTakRemoteSettings,
  tlsConnectHost,
  validateTakRemoteSettings,
} from './remote-settings';

const VALID = {
  host: 'tak.example.org',
  port: 8089,
  verifyServer: true,
  allowNameMismatch: false,
  autoConnect: false,
};
const settingsFile = path.join(userData, 'tak-remote-settings.json');

afterAll(() => {
  fs.rmSync(userData, { recursive: true, force: true });
});

describe('validateTakRemoteSettings', () => {
  it.each([
    ['a hostname', VALID],
    ['an IPv4 address', { ...VALID, host: '10.0.0.5' }],
    ['a bracketed IPv6 address', { ...VALID, host: '[fd00::5]' }],
    ['port 443', { ...VALID, port: 443 }],
  ])('accepts %s', (_label, settings) => {
    expect(() => {
      validateTakRemoteSettings(settings);
    }).not.toThrow();
  });

  it.each([
    ['null', null],
    ['an empty host', { ...VALID, host: '' }],
    ['a URL instead of a host', { ...VALID, host: 'ssl://tak.example.org:8089' }],
    ['a host with a port', { ...VALID, host: 'tak.example.org:8089' }],
    ['port 0', { ...VALID, port: 0 }],
    ['port 70000', { ...VALID, port: 70000 }],
    ['a string port', { ...VALID, port: '8089' }],
    ['a missing verifyServer', { ...VALID, verifyServer: undefined }],
    ['a non-boolean autoConnect', { ...VALID, autoConnect: 'yes' }],
    ['a non-boolean allowNameMismatch', { ...VALID, allowNameMismatch: 1 }],
  ])('rejects %s', (_label, settings) => {
    expect(() => {
      validateTakRemoteSettings(settings);
    }).toThrow(/tak:remoteStart/);
  });
});

describe('tlsConnectHost', () => {
  it('strips IPv6 brackets and whitespace', () => {
    expect(tlsConnectHost(' [fd00::5] ')).toBe('fd00::5');
    expect(tlsConnectHost('tak.example.org')).toBe('tak.example.org');
  });
});

describe('remote settings persistence', () => {
  beforeEach(() => {
    fs.rmSync(settingsFile, { force: true });
  });

  it('returns null when nothing was saved', () => {
    expect(loadTakRemoteSettings()).toBeNull();
  });

  it('round-trips only the known fields, with the host trimmed', () => {
    saveTakRemoteSettings({
      ...VALID,
      host: '  tak.example.org ',
      extra: 'dropped',
    } as typeof VALID & { extra: string });
    expect(loadTakRemoteSettings()).toEqual(VALID);
    expect(fs.existsSync(`${settingsFile}.tmp`)).toBe(false);
  });

  it('never saves an unverified relay to connect at launch', () => {
    saveTakRemoteSettings({ ...VALID, verifyServer: false, autoConnect: true });
    expect(loadTakRemoteSettings()).toMatchObject({ verifyServer: false, autoConnect: false });
  });

  it('loads settings saved before allowNameMismatch with the name check on', () => {
    const older: Record<string, unknown> = { ...VALID };
    delete older.allowNameMismatch;
    fs.writeFileSync(settingsFile, JSON.stringify(older));
    expect(loadTakRemoteSettings()).toEqual({ ...VALID, allowNameMismatch: false });
  });

  it('throws on a corrupt settings file instead of connecting with bad values', () => {
    fs.writeFileSync(settingsFile, JSON.stringify({ host: '', port: -1 }));
    expect(() => loadTakRemoteSettings()).toThrow(/host/);
  });
});
