/**
 * Source contract: Reticulum Peers tab keep-alive (avoids remount + full path-table dump).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'App.tsx'), 'utf-8');

describe('App Peers tab keep-alive (regression)', () => {
  it('tracks peersTabVisited and keeps ReticulumPeerListPanel mounted after first visit', () => {
    expect(SOURCE).toContain('peersTabVisited');
    expect(SOURCE).toContain('setPeersTabVisited(true)');
    expect(SOURCE).toMatch(/\(activePanelIndex === NODES_PANEL_INDEX \|\| peersTabVisited\) && \(/);
    expect(SOURCE).toContain('onSoftRefresh={reticulumPanelActions.requestSoftRefresh}');
  });

  it('clears peersTabVisited on protocol switch', () => {
    expect(SOURCE).toMatch(/setPeersTabVisited\(false\)/);
  });
});
