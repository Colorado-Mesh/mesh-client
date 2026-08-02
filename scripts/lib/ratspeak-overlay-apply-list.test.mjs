import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const listPath = fileURLToPath(new URL('./ratspeak-overlay-apply-list.sh', import.meta.url));
const helperPath = fileURLToPath(new URL('./apply-ratspeak-overlay.sh', import.meta.url));
const updatePath = fileURLToPath(new URL('../update.sh', import.meta.url));

describe('ratspeak overlay apply list', () => {
  it('lists every apply-rs script used by clone/ensure', () => {
    const list = readFileSync(listPath, 'utf8');
    expect(list).toContain('RS_RETICULUM_APPLY_SCRIPTS');
    expect(list).toContain('RS_LXMF_APPLY_SCRIPTS');
    expect(list).toContain('apply_ratspeak_rns_overlays');
    expect(list).toContain('apply-rsReticulum-path-medium-slots.sh');
    expect(list).toContain('apply-rsLXMF-link-delivery-has-pending-to.sh');
  });

  it('keeps apply helper fail-loud with stderr capture', () => {
    const helper = readFileSync(helperPath, 'utf8');
    expect(helper).toContain('apply_ratspeak_overlay_or_die');
    expect(helper).toContain('apply --check');
    // Must not swallow git-apply diagnostics (rev-parse may still redirect).
    expect(helper).not.toMatch(/git -C .* apply .*2>\s*\/dev\/null/);
  });

  it('patch basenames in update.sh match apply-list overlays', () => {
    const list = readFileSync(listPath, 'utf8');
    const update = readFileSync(updatePath, 'utf8');
    const applyNames = [...list.matchAll(/apply-(rs(?:Reticulum|LXMF)-[a-z0-9-]+)\.sh/g)].map(
      (m) => `${m[1]}.patch`,
    );
    expect(applyNames.length).toBeGreaterThanOrEqual(10);
    for (const patch of applyNames) {
      expect(update).toContain(patch);
    }
  });
});
