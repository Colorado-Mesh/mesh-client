import { describe, expect, it } from 'vitest';

import { extractMeshcomExtUdpConsoleJson } from './meshcomExtUdpConsole';

describe('extractMeshcomExtUdpConsoleJson', () => {
  it('passes through bare JSON', () => {
    expect(extractMeshcomExtUdpConsoleJson('{"type":"msg","dst":"*","msg":"hi"}')).toBe(
      '{"type":"msg","dst":"*","msg":"hi"}',
    );
  });

  it('strips [EXT] Out / Tele-Out wrappers', () => {
    const json = '{"src_type":"lora","type":"msg","src":"A-1","dst":"*","msg":"Hi"}';
    expect(extractMeshcomExtUdpConsoleJson(`[EXT] Out: ${json} Len: 120`)).toBe(json);
    expect(extractMeshcomExtUdpConsoleJson(`[EXT] Tele-Out: ${json} Len: 90`)).toBe(json);
  });

  it('returns null for banners', () => {
    expect(extractMeshcomExtUdpConsoleJson('MeshCom Console')).toBeNull();
  });
});
