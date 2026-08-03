import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cloneScriptPath = fileURLToPath(new URL('./clone-ratspeak-stack.sh', import.meta.url));
const cloneScript = readFileSync(cloneScriptPath, 'utf8');

describe('clone-ratspeak-stack.sh float policy', () => {
  it('floats rsReticulum and rsLXMF to origin/main by default', () => {
    expect(cloneScript).toContain("target_ref='origin/main'");
    expect(cloneScript).toContain('checkout --quiet --detach');
    expect(cloneScript).toMatch(/RS_RETICULUM_REF="\$\{RS_RETICULUM_REF:-\}"/);
    expect(cloneScript).toMatch(/RS_LXMF_REF="\$\{RS_LXMF_REF:-\}"/);
    expect(cloneScript).toContain('export RS_RETICULUM_DIR=');
    expect(cloneScript).toContain('export RS_LXMF_DIR=');
    expect(cloneScript).toContain('refuse to float/pin');
    expect(cloneScript).toContain('already at');
    expect(cloneScript).toContain('skipping checkout');
    expect(cloneScript).toContain('origin/${ref_or_empty}');
    expect(cloneScript).toContain('Ratspeak stack SHAs (full)');
    expect(cloneScript).toContain('ratspeak-overlay-apply-list.sh');
    expect(cloneScript).not.toMatch(/9928abed269a83ec5a7ef165ff1142d938cad706/);
    expect(cloneScript).not.toMatch(/68ad7c835187c052c763bb28c41b04a655f35c64/);
  });

  it('floats rsNomad to origin/main with optional RS_NOMAD_REF pin', () => {
    expect(cloneScript).toMatch(/RS_NOMAD_REF="\$\{RS_NOMAD_REF:-\}"/);
    expect(cloneScript).toContain('Colorado-Mesh/rsNomad.git');
    expect(cloneScript).toContain("nomad_mode='floated origin/main'");
    expect(cloneScript).not.toContain('6e3b288fbc6931b1e2633d986cf0d49608d578b7');
    expect(cloneScript).not.toContain('RS_NOMAD_SKIP_PIN');
  });

  it('floats rsLXST to origin/main with optional RS_LXST_REF pin', () => {
    expect(cloneScript).toMatch(/RS_LXST_REF="\$\{RS_LXST_REF:-\}"/);
    expect(cloneScript).toContain('ratspeak/rsLXST.git');
    expect(cloneScript).toContain("lxst_mode='floated origin/main'");
    expect(cloneScript).toContain('rsLXST @');
  });

  it('applies rsReticulum and rsLXMF overlays after checkout via shared list', () => {
    expect(cloneScript).toContain('apply_ratspeak_rns_overlays');
    expect(cloneScript).toContain('apply_ratspeak_lxmf_overlays');
    const rnsEnsure = cloneScript.indexOf('ensure_repo "${RNS_DIR}"');
    const rnsApply = cloneScript.indexOf('apply_ratspeak_rns_overlays');
    const lxmfEnsure = cloneScript.indexOf('ensure_repo "${LXMF_DIR}"');
    const lxmfApply = cloneScript.indexOf('apply_ratspeak_lxmf_overlays');
    expect(rnsEnsure).toBeGreaterThanOrEqual(0);
    expect(rnsApply).toBeGreaterThan(rnsEnsure);
    expect(lxmfEnsure).toBeGreaterThan(rnsApply);
    expect(lxmfApply).toBeGreaterThan(lxmfEnsure);

    const listPath = fileURLToPath(
      new URL('./lib/ratspeak-overlay-apply-list.sh', import.meta.url),
    );
    const listScript = readFileSync(listPath, 'utf8');
    expect(listScript).toContain('apply-rsReticulum-packet-tap.sh');
    expect(listScript).toContain('apply-rsLXMF-propagation-node-policy-setters.sh');
  });
});
