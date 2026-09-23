import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => os.tmpdir(),
  },
}));

describe('mecp-received-log', () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'mecp-log-'));
    vi.resetModules();
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(workDir, { recursive: true, force: true });
    } catch {
      // catch-no-log-ok cleanup
    }
  });

  it('appends sanitized JSONL and exports content', async () => {
    const mod = await import('./mecp-received-log');
    const logPath = path.join(workDir, 'mecp-received.log');
    mod.setMecpReceivedLogPathForTests(logPath);

    await mod.appendMecpReceivedLog({
      protocol: 'meshtastic',
      severity: 0,
      drill: false,
      from: '!\x00bad',
      payload: 'MECP/0/M01',
      decoded: 'Injury',
    });

    const text = await mod.readMecpReceivedLogForExport();
    expect(text).toContain('MECP/0/M01');
    expect(text).toContain('"severity":0');
    const line = JSON.parse(text.trim().split('\n').pop()!) as { from?: string };
    expect(line.from).not.toContain('\x00');
  });

  it('validates append payloads', async () => {
    const { isValidMecpAppendPayload } = await import('./mecp-received-log');
    expect(
      isValidMecpAppendPayload({
        protocol: 'meshcore',
        severity: 1,
        drill: true,
        payload: 'MECP/1/D01',
      }),
    ).toBe(true);
    expect(isValidMecpAppendPayload({ protocol: 'x', drill: false })).toBe(false);
    expect(
      isValidMecpAppendPayload({
        protocol: 'meshtastic',
        severity: 9,
        drill: false,
        payload: 'MECP/0/M01',
      }),
    ).toBe(false);
  });
});
