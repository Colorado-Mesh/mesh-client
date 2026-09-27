/**
 * Source contract: Reticulum peer-detail modal must be isolated so a React #185 /
 * render failure cannot take down the App shell; resetKeys recover on peer switch.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const TEST_DIR = import.meta.dirname ?? __dirname;
const SOURCE = readFileSync(join(TEST_DIR, 'App.tsx'), 'utf-8');

describe('App ReticulumPeerDetailModal ErrorBoundary (regression)', () => {
  it('wraps ReticulumPeerDetailModal in ReticulumPeerDetailErrorBoundary with Suspense fallback', () => {
    expect(SOURCE).toContain('ReticulumPeerDetailErrorBoundary');
    // v6: one render helper serves both the Peers detail pane and the modal fallback.
    expect(SOURCE).toMatch(
      /const renderPeerDetail = \(variant: 'modal' \| 'pane'\) =>\s*selectedPeerHash === null \? null : \(\s*<ReticulumPeerDetailErrorBoundary[\s\S]*?peerHash=\{selectedPeerHash\}[\s\S]*?suspenseFallback=\{<DialogLazyFallback \/>\}[\s\S]*?<ReticulumPeerDetailModal/,
    );
  });

  it('remounts the peer and node details per selection so edits never carry over', () => {
    // The pane stays mounted while the list selection changes; without a key a half-typed
    // rename for peer A was saved to peer B.
    expect(SOURCE).toMatch(/<ReticulumPeerDetailModal[\s\S]*?key=\{selectedPeerHash\}/);
    expect(SOURCE).toMatch(/<NodeDetailModal[\s\S]*?key=\{selectedNode\?\.node_id \?\? 'none'\}/);
  });

  it('mounts the peer detail only through the boundary-wrapped helper', () => {
    expect(SOURCE.match(/<ReticulumPeerDetailModal\b/g)).toHaveLength(1);
    // Pane beside the Peers list or beside the map, modal otherwise.
    expect(SOURCE).toContain("peerDetailPaneOnList && renderPeerDetail('pane')");
    expect(SOURCE).toContain("peerDetailPaneOnMap && renderPeerDetail('pane')");
    expect(SOURCE).toContain("peerDetailModalOpen && renderPeerDetail('modal')");
  });
});
