// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { isLxmfRecentApiPath } from './reticulumLxmfRecentPath';

const HANDLERS_SOURCE = readFileSync(join(__dirname, 'reticulum-handlers.ts'), 'utf-8');
const SIDECAR_STACK_SOURCE = readFileSync(
  join(__dirname, '../../../reticulum-sidecar/src/stack/mod.rs'),
  'utf-8',
);
const SIDECAR_LIVE_SOURCE = readFileSync(
  join(__dirname, '../../../reticulum-sidecar/src/stack/live.rs'),
  'utf-8',
);

describe('reticulum proxy rate limit + 100k peer ceilings (source contract)', () => {
  it('caps shared proxy IPC at 900/min and treats rate-limit as expected', () => {
    expect(HANDLERS_SOURCE).toMatch(/max:\s*900/);
    expect(HANDLERS_SOURCE).toContain("label: 'reticulum:proxy'");
    expect(HANDLERS_SOURCE).toContain('isExpectedReticulumProxyError');
    expect(HANDLERS_SOURCE).toContain("from '../../shared/reticulumProxyIpcError'");
    const sharedSource = readFileSync(
      join(__dirname, '../../shared/reticulumProxyIpcError.ts'),
      'utf-8',
    );
    expect(sharedSource).toContain("lower.includes('rate limit exceeded')");
  });

  it('routes LXMF recent catch-up onto a dedicated 120/min bucket', () => {
    expect(HANDLERS_SOURCE).toMatch(
      /const reticulumLxmfRecentIpcRateLimit = createIpcRateLimiter\(\{\s*max:\s*120,[\s\S]*?label:\s*'reticulum:lxmfRecent'/,
    );
    expect(HANDLERS_SOURCE).toContain('isLxmfRecentApiPath');
    expect(HANDLERS_SOURCE).toContain('reticulumLxmfRecentIpcRateLimit.checkOrThrow()');
    expect(isLxmfRecentApiPath('/api/v1/lxmf/recent')).toBe(true);
    expect(isLxmfRecentApiPath('/api/v1/lxmf/recent?since_ts=1')).toBe(true);
    expect(isLxmfRecentApiPath('/api/v1/lxmf/send')).toBe(false);
  });

  it('applies the shared proxy rate limit to picker-gated RNCP handlers', () => {
    // Dedicated rncpSend/Fetch/setRncpListener bypass generic proxyPost gating but must
    // still share the 900/min ceiling so a compromised renderer cannot storm the sidecar.
    for (const channel of [
      'reticulum:rncpSend',
      'reticulum:rncpFetch',
      'reticulum:setRncpListener',
    ] as const) {
      const handleIdx = HANDLERS_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
      expect(handleIdx, channel).toBeGreaterThanOrEqual(0);
      const afterHandle = HANDLERS_SOURCE.slice(handleIdx, handleIdx + 500);
      expect(afterHandle).toContain('reticulumProxyIpcRateLimit.checkOrThrow()');
    }
  });

  it('settles shared proxy rate-limit rejections inside try (soft envelope, not raw throw)', () => {
    // checkOrThrow must run after `try {` so settleReticulumProxyFailure can return an
    // expected envelope — otherwise Electron logs `[error] Error occurred in handler`.
    for (const channel of [
      'reticulum:proxyGet',
      'reticulum:proxyPost',
      'reticulum:proxyPut',
      'reticulum:proxyDelete',
    ] as const) {
      const handleIdx = HANDLERS_SOURCE.indexOf(`ipcMain.handle('${channel}'`);
      expect(handleIdx, channel).toBeGreaterThanOrEqual(0);
      const afterHandle = HANDLERS_SOURCE.slice(handleIdx, handleIdx + 1200);
      const tryIdx = afterHandle.indexOf('try {');
      const checkIdx = afterHandle.indexOf('reticulumProxyIpcRateLimit.checkOrThrow()');
      expect(tryIdx, channel).toBeGreaterThanOrEqual(0);
      expect(checkIdx, channel).toBeGreaterThan(tryIdx);
      expect(afterHandle).toContain('settleReticulumProxyFailure');
    }
  });

  it('routes LXST PCM through a dedicated higher-budget IPC channel', () => {
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:voiceSendAudio'");
    expect(HANDLERS_SOURCE).toMatch(/max:\s*2000/);
    expect(HANDLERS_SOURCE).toContain("label: 'reticulum:voiceSendAudio'");
    expect(HANDLERS_SOURCE).toContain('reticulumVoiceAudioIpcRateLimit.checkOrThrow()');
    expect(HANDLERS_SOURCE).toContain('voice PCM ingest requires reticulum:voiceSendAudio');
    expect(HANDLERS_SOURCE).toContain('VOICE_AUDIO_API_PATH');
    const preload = readFileSync(join(__dirname, '../../preload/index.ts'), 'utf-8');
    expect(preload).toContain("ipcRenderer.invoke('reticulum:voiceSendAudio'");
    expect(preload).not.toMatch(/invoke\('reticulum:proxyPost',\s*'\/api\/v1\/voice\/audio'/);
  });

  it('routes voice memo PCM through dedicated IPC with its own rate limit and blocks proxy', () => {
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:voiceMemoStart'");
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:voiceMemoSendAudio'");
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:voiceMemoStop'");
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:voiceMemoCancel'");
    expect(HANDLERS_SOURCE).toContain('voice memo requires reticulum:voiceMemo* IPC channels');
    const preload = readFileSync(join(__dirname, '../../preload/index.ts'), 'utf-8');
    expect(preload).toContain("ipcRenderer.invoke('reticulum:voiceMemoStart'");
    expect(preload).toContain("ipcRenderer.invoke('reticulum:voiceMemoSendAudio'");
    expect(preload).toContain("ipcRenderer.invoke('reticulum:voiceMemoStop'");
    expect(preload).toContain("ipcRenderer.invoke('reticulum:voiceMemoCancel'");
    expect(preload).not.toMatch(/invoke\('reticulum:proxyPost',\s*'\/api\/v1\/voice\/memo/);
  });

  it('routes LRGP games through dedicated IPC with its own rate limit', () => {
    expect(HANDLERS_SOURCE).toMatch(
      /const reticulumGamesIpcRateLimit = createIpcRateLimiter\(\{\s*max:\s*600,[\s\S]*?label:\s*'reticulum:games'/,
    );
    expect(HANDLERS_SOURCE).toContain('reticulumGamesIpcRateLimit.checkOrThrow()');
    expect(HANDLERS_SOURCE).toContain('LRGP games require reticulum:games* IPC channels');
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesStatus'");
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesAction'");
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesDeleteSession'");
    const preload = readFileSync(join(__dirname, '../../preload/index.ts'), 'utf-8');
    expect(preload).toContain("ipcRenderer.invoke('reticulum:gamesStatus'");
    expect(preload).toContain("ipcRenderer.invoke('reticulum:gamesAction'");
    expect(preload).not.toMatch(/invoke\('reticulum:proxyGet'[\s\S]*?\/api\/v1\/games/);
    expect(preload).not.toMatch(/invoke\('reticulum:proxyPost'[\s\S]*?\/api\/v1\/games/);
  });

  it('aligns sidecar peer cache and WS added batch with ~100k scale', () => {
    expect(SIDECAR_STACK_SOURCE).toMatch(/const MAX_PEER_CACHE: usize = 100_000;/);
    expect(SIDECAR_LIVE_SOURCE).toMatch(/const MAX_PEERS_UPDATED_ADDED: usize = 4096;/);
    expect(SIDECAR_LIVE_SOURCE).toMatch(/const MAX_DISPLAY_NAME_CACHE: usize = 100_000;/);
    expect(SIDECAR_LIVE_SOURCE).toMatch(
      /const TRANSPORT_QUERY_TIMEOUT: Duration = Duration::from_secs\(20\);/,
    );
  });
});
