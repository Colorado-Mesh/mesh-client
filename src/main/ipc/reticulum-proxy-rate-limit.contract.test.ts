// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

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
  it('caps shared proxy IPC at 300/min and treats rate-limit as expected', () => {
    expect(HANDLERS_SOURCE).toMatch(/max:\s*300/);
    expect(HANDLERS_SOURCE).toContain("label: 'reticulum:proxy'");
    expect(HANDLERS_SOURCE).toContain('isExpectedReticulumProxyError');
    expect(HANDLERS_SOURCE).toContain("from '../../shared/reticulumProxyIpcError'");
    const sharedSource = readFileSync(
      join(__dirname, '../../shared/reticulumProxyIpcError.ts'),
      'utf-8',
    );
    expect(sharedSource).toContain("lower.includes('rate limit exceeded')");
  });

  it('applies the shared proxy rate limit to picker-gated RNCP handlers', () => {
    // Dedicated rncpSend/Fetch/setRncpListener bypass generic proxyPost gating but must
    // still share the 300/min ceiling so a compromised renderer cannot storm the sidecar.
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

  it('routes LRGP games through dedicated IPC with its own rate limit', () => {
    expect(HANDLERS_SOURCE).toContain("label: 'reticulum:games'");
    expect(HANDLERS_SOURCE).toMatch(/max:\s*600/);
    expect(HANDLERS_SOURCE).toContain('reticulumGamesIpcRateLimit.checkOrThrow()');
    expect(HANDLERS_SOURCE).toContain('LRGP games require reticulum:games* IPC channels');
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesStatus'");
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesAction'");
    expect(HANDLERS_SOURCE).toContain("ipcMain.handle('reticulum:gamesDeleteSession'");
    const preload = readFileSync(join(__dirname, '../../preload/index.ts'), 'utf-8');
    expect(preload).toContain("ipcRenderer.invoke('reticulum:gamesStatus'");
    expect(preload).toContain("ipcRenderer.invoke('reticulum:gamesAction'");
    expect(preload).not.toMatch(/invoke\('reticulum:proxyGet',\s*'\/api\/v1\/games/);
    expect(preload).not.toMatch(/invoke\('reticulum:proxyPost',\s*'\/api\/v1\/games/);
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
