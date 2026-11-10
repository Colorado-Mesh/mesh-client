/**
 * Source contract: per-protocol Chat keep-alive (avoids remount after idle protocol switches).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'App.tsx'), 'utf-8');
const COMMIT = readFileSync(join(TEST_DIR, 'lib/protocolSwitchCommit.ts'), 'utf-8');

describe('App Chat keep-alive (regression)', () => {
  it('tracks visitedChatProtocols and does not clear Chat on protocol switch', () => {
    expect(SOURCE).toContain('visitedChatProtocols');
    expect(SOURCE).toContain('setVisitedChatProtocols');
    expect(SOURCE).toMatch(
      /activePanelIndex !== CHAT_PANEL_INDEX \|\| visitedChatProtocols\.has\(protocol\)/,
    );
    expect(SOURCE).not.toContain('setChatTabVisited');
    expect(SOURCE).not.toContain('flags.chat');
    expect(COMMIT).toContain('Chat is intentionally omitted');
    expect(COMMIT).not.toMatch(/chat:\s*(true|false)/);
  });

  it('renders one ChatPanel per visited protocol without key={protocol} remount', () => {
    expect(SOURCE).toContain(
      'REGISTERED_MESH_PROTOCOLS.filter((chatProtocol) =>\n                              visitedChatProtocols.has(chatProtocol),',
    );
    expect(SOURCE).toContain('key={chatProtocol}');
    const chatBlock = SOURCE.slice(
      SOURCE.indexOf('visitedChatProtocols.size > 0) && ('),
      SOURCE.indexOf('id={`panel-${GAMES_PANEL_INDEX}`}'),
    );
    expect(chatBlock).toContain('<ChatPanel');
    expect(chatBlock).not.toContain('key={protocol}');
  });

  it('does not re-arm startup hydrate on every protocol switch', () => {
    expect(SOURCE).toContain('hydrateActiveProtocolRef');
    expect(SOURCE).toContain('const activeProtocol = hydrateActiveProtocolRef.current;');
    const depsStart = SOURCE.indexOf('refreshReticulumAllFromDb,\n  ]);');
    expect(depsStart).toBeGreaterThan(-1);
    // Hydrate effect deps must not list `protocol` (ref carries active-first ordering).
    const depsBlock = SOURCE.slice(depsStart - 220, depsStart + 40);
    expect(depsBlock).toContain('startupPruneDone');
    expect(depsBlock).not.toMatch(/\bprotocol\b/);
  });
});
