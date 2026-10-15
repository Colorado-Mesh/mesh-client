import { describe, expect, it, vi } from 'vitest';

import {
  formatMeshcoreCompanionCliForLog,
  isMeshcoreCompanionSensitiveCommand,
  type MeshcoreCompanionCliResult,
} from './meshcoreCompanionCli';
import {
  applyMeshcoreCompanionSetting,
  getMeshcoreCompanionSetting,
  MESHCORE_COMPANION_SETTINGS,
  meshcoreCliReplyNeedsReboot,
  readAllMeshcoreCompanionSettings,
} from './meshcoreCompanionSettings';

function runnerFrom(replies: Record<string, string>) {
  return vi.fn((command: string): Promise<MeshcoreCompanionCliResult> => {
    const reply = replies[command] ?? 'Unknown command';
    return Promise.resolve(
      reply === 'Unknown command' ? { kind: 'unsupported', reply } : { kind: 'ok', reply },
    );
  });
}

const V118_WIFI_REPLIES: Record<string, string> = {
  ver: 'v1.18.0 (Build: 15 Oct 2026)',
  board: 'Heltec V3',
  'get tz.offset': '> -7',
  'get af': '> 1.0',
  'get dutycycle': '> 50.0%',
  'get int.thresh': '> 0',
  'get cad': '> off',
  'get radio.rxgain': '> on',
  'get rxdelay': '> 0.0',
  'get agc.reset.interval': '> 0',
  'get txdelay': '> 0.5',
  'get direct.txdelay': '> 0.2',
  'get wifi.enabled': '> 1',
  'get wifi.ssid': '> HomeNet',
  'get wifi.status': '> connected',
  'get wifi.ip': '> 192.168.1.40',
};

describe('meshcoreCompanionSettings', () => {
  it('reads and normalizes every readable setting on a WiFi build', async () => {
    const run = runnerFrom(V118_WIFI_REPLIES);
    const snap = await readAllMeshcoreCompanionSettings(run);
    expect(snap.wifiSupported).toBe(true);
    expect(snap.unsupported).toEqual([]);
    expect(snap.values).toMatchObject({
      ver: 'v1.18.0 (Build: 15 Oct 2026)',
      'tz.offset': '-7',
      af: '1.0',
      dutycycle: '50.0%',
      cad: 'off',
      'radio.rxgain': 'on',
      'wifi.enabled': 'on',
      'wifi.ssid': 'HomeNet',
      'wifi.status': 'connected',
      'wifi.ip': '192.168.1.40',
    });
    expect(run).not.toHaveBeenCalledWith('get wifi.pwd');
  });

  it('marks WiFi unsupported after the probe and skips the rest of the group', async () => {
    const replies = { ...V118_WIFI_REPLIES };
    delete replies['get wifi.enabled'];
    const run = runnerFrom(replies);
    const snap = await readAllMeshcoreCompanionSettings(run);
    expect(snap.wifiSupported).toBe(false);
    expect(snap.unsupported).toEqual(
      expect.arrayContaining(['wifi.enabled', 'wifi.ssid', 'wifi.status', 'wifi.ip']),
    );
    expect(run).not.toHaveBeenCalledWith('get wifi.ssid');
  });

  it('normalizes empty SSID and disconnected IP placeholders', async () => {
    const run = runnerFrom({
      ...V118_WIFI_REPLIES,
      'get wifi.ssid': '> (not set)',
      'get wifi.ip': '> (not connected)',
      'get wifi.enabled': '> 0',
    });
    const snap = await readAllMeshcoreCompanionSettings(run);
    expect(snap.values['wifi.ssid']).toBe('');
    expect(snap.values['wifi.ip']).toBe('');
    expect(snap.values['wifi.enabled']).toBe('off');
  });

  it('builds the firmware set commands', () => {
    const cmd = (key: string, v: string) => getMeshcoreCompanionSetting(key)?.setCommand?.(v);
    expect(cmd('wifi.enabled', 'on')).toBe('set wifi.enabled 1');
    expect(cmd('wifi.enabled', 'off')).toBe('set wifi.enabled 0');
    expect(cmd('cad', 'on')).toBe('set cad on');
    expect(cmd('tz.offset', ' -7 ')).toBe('set tz.offset -7');
    expect(cmd('wifi.pwd', 'p w ')).toBe('set wifi.pwd p w ');
    expect(cmd('pin', '123456')).toBe('set pin 123456');
  });

  it('validates ranges and formats', () => {
    const v = (key: string, value: string) =>
      getMeshcoreCompanionSetting(key)?.validate?.(value) ?? null;
    expect(v('tz.offset', '15')).toBe('outOfRange');
    expect(v('tz.offset', '1.5')).toBe('notInteger');
    expect(v('af', 'abc')).toBe('notNumber');
    expect(v('af', '2.5')).toBeNull();
    expect(v('txdelay', '2.1')).toBe('outOfRange');
    expect(v('pin', '12345')).toBe('pinFormat');
    expect(v('pin', '0')).toBeNull();
    expect(v('wifi.ssid', '')).toBe('required');
    expect(v('wifi.ssid', 'x'.repeat(33))).toBe('tooLong');
    expect(v('wifi.ssid', 'a|b')).toBeNull();
    expect(v('wifi.pwd', '')).toBeNull();
    expect(v('wifi.pwd', 'bad\npwd')).toBe('invalidChars');
  });

  it('applies a setting and reports reboot requirements', async () => {
    const run = runnerFrom({ 'set wifi.enabled 1': '> wifi.enabled is now 1 (reboot to apply)' });
    await expect(applyMeshcoreCompanionSetting(run, 'wifi.enabled', 'on')).resolves.toEqual({
      ok: true,
      reply: 'wifi.enabled is now 1 (reboot to apply)',
      rebootRequired: true,
    });
  });

  it('reports firmware error replies as not ok', async () => {
    const run = runnerFrom({ 'set radio.rxgain on': 'Error: unsupported' });
    await expect(applyMeshcoreCompanionSetting(run, 'radio.rxgain', 'on')).resolves.toMatchObject({
      ok: false,
      rebootRequired: false,
    });
  });

  it('refuses invalid values and read-only keys before sending', async () => {
    const run = runnerFrom({});
    await expect(applyMeshcoreCompanionSetting(run, 'tz.offset', '99')).rejects.toThrow();
    await expect(applyMeshcoreCompanionSetting(run, 'ver', 'x')).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('flags password and PIN commands as sensitive', () => {
    expect(isMeshcoreCompanionSensitiveCommand('set wifi.pwd hunter2')).toBe(true);
    expect(isMeshcoreCompanionSensitiveCommand('ab|get wifi.pwd')).toBe(true);
    expect(isMeshcoreCompanionSensitiveCommand('set pin 123456')).toBe(true);
    expect(isMeshcoreCompanionSensitiveCommand('get wifi.ssid')).toBe(false);
  });

  it('redacts secrets from log lines', () => {
    const line = formatMeshcoreCompanionCliForLog('set wifi.pwd hunter2', '> wifi.pwd updated');
    expect(line).not.toContain('hunter2');
    expect(line).toContain('[redacted]');
    expect(formatMeshcoreCompanionCliForLog('get wifi.pwd', '> hunter2')).not.toContain('hunter2');
    expect(formatMeshcoreCompanionCliForLog('set pin 123456')).not.toContain('123456');
    expect(formatMeshcoreCompanionCliForLog('get wifi.ssid', '> Home')).toContain('Home');
  });

  it('detects reboot-to-apply replies', () => {
    expect(meshcoreCliReplyNeedsReboot('OK - reboot to apply')).toBe(true);
    expect(
      meshcoreCliReplyNeedsReboot('> wifi.ssid is now x (set wifi.pwd too, then reboot)'),
    ).toBe(true);
    expect(meshcoreCliReplyNeedsReboot('OK')).toBe(false);
  });

  it('has unique keys', () => {
    const keys = MESHCORE_COMPANION_SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
