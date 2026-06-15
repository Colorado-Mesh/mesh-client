/**
 * Regression guard: MeshCore RPC auth dialogs must stack above NodeDetailModal.
 *
 * Commit d264b486 raised NodeDetailModal to z 10000 for map layering while repeater/room
 * auth overlays stayed at z 200, making Request Status / telemetry / export appear dead.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { Z_NESTED_AUTH_OVERLAY, Z_NODE_DETAIL_MODAL } from './modalZIndex';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function readRenderer(pathFromRenderer: string): string {
  return readFileSync(join(ROOT, pathFromRenderer), 'utf8');
}

describe('modal z-index layering contract', () => {
  it('NodeDetailModal uses Z_NODE_DETAIL_MODAL (not a stale hard-coded class)', () => {
    const src = readRenderer('components/NodeDetailModal.tsx');
    expect(src).toContain('Z_NODE_DETAIL_MODAL');
    expect(src).toMatch(/style=\{\{\s*zIndex:\s*Z_NODE_DETAIL_MODAL\s*\}\}/);
    expect(src).not.toMatch(/z-\[10000\]/);
  });

  it('repeater and room auth hooks use Z_NESTED_AUTH_OVERLAY above the node modal', () => {
    for (const file of [
      'hooks/useMeshcoreRepeaterRemoteAuth.tsx',
      'hooks/useMeshcoreRoomAuth.tsx',
    ]) {
      const src = readRenderer(file);
      expect(src).toContain('Z_NESTED_AUTH_OVERLAY');
      expect(src).toMatch(/style=\{\{\s*zIndex:\s*Z_NESTED_AUTH_OVERLAY\s*\}\}/);
      expect(src).not.toMatch(/z-\[200\]/);
    }
  });

  it('constants remain ordered so auth can cover node detail', () => {
    expect(Z_NESTED_AUTH_OVERLAY).toBeGreaterThan(Z_NODE_DETAIL_MODAL);
  });
});
