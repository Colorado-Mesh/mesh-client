// @vitest-environment jsdom
/**
 * Source contract tests for RRC multi-hub WebSocket event routing.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'useReticulumRuntime.ts'), 'utf-8');

describe('useReticulumRuntime RRC event routing (regression)', () => {
  it('honors will_reconnect=false by clearing the hub session', () => {
    expect(SOURCE).toMatch(/will_reconnect\?: boolean/);
    expect(SOURCE).toMatch(/p\.will_reconnect === false/);
    expect(SOURCE).toMatch(
      /p\.reason === 'local_disconnect'[\s\S]*?disconnectIntentForHub[\s\S]*?p\.will_reconnect === false[\s\S]*?clearHubSession/,
    );
  });

  it('keeps rooms while sidecar auto-reconnects when will_reconnect is true or omitted', () => {
    expect(SOURCE).toMatch(/willReconnect \|\| p\.will_reconnect === undefined/);
    expect(SOURCE).toMatch(/applyStatus\('reconnecting'/);
  });

  it('routes rrc.connected status and capabilities to the addressed hub', () => {
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.connected'/);
    expect(SOURCE).toMatch(/applyStatus\(st, hubDestHash/);
    expect(SOURCE).toMatch(/setCapabilities\([\s\S]*?hubDestHash/);
    expect(SOURCE).toMatch(/applyWelcomeName\(hubDestHash/);
  });

  it('routes room join/part and messages with hub_dest_hash', () => {
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.room\.joined'/);
    expect(SOURCE).toMatch(/roomJoined\(p\.room, p\.members, p\.hub_dest_hash/);
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.room\.parted'/);
    expect(SOURCE).toMatch(/roomParted\(p\.room, \{ forced: !voluntary \}, hubDestHash\)/);
    expect(SOURCE).toMatch(/evt\.type === 'rrc\.message'/);
    expect(SOURCE).toMatch(/hub_dest_hash\?: string \| null/);
    expect(SOURCE).toMatch(/addMessage\([\s\S]*?\{ hubDestHash \}/);
  });
});
