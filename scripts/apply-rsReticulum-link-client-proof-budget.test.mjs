import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const APPLY_SCRIPT = path.join(SCRIPT_DIR, 'apply-rsReticulum-link-client-proof-budget.sh');
const PATCH_FILE = path.join(
  REPO_ROOT,
  'reticulum-sidecar/patches/rsReticulum-link-client-proof-budget.patch',
);

/** Preimage matching the proof-budget patch hunk (post–Nomad overlay `}))`). */
const FRESH_LINK_CLIENT = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        }))
        .await?;

        let proof_data = wait_for_proof(&mut dest_rx, link_id, time_remaining(deadline)?).await?;

        let identity_ed25519_pub: [u8; 32] = pubkey[32..64].try_into().map_err(|_| {
            LinkClientError::ProofInvalid("remote public key is not 64 bytes".into())
        })?;
        Ok(())
    }
}
`;

const UPSTREAM_EQUIVALENT = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        // Release / v5.25.0 parity: use remaining overall deadline for LRPROOF.
        let proof_budget = time_remaining(deadline)?;
        let proof_data = wait_for_proof(&mut dest_rx, link_id, proof_budget).await?;
        Ok(())
    }
}
`;

/** Floated origin/main: remaining deadline via wait_for_valid_proof. */
const UPSTREAM_VALID_PROOF = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        timeout(
            time_remaining(deadline)?,
            crate::link_endpoint::wait_for_valid_proof(
                &mut dest_rx,
                &mut link,
                &identity_verify_key,
                &identity_ed25519_pub,
            ),
        )
        .await?;
        Ok(())
    }
}
`;

/** Older #756 establishment-only cap — apply script must migrate to remaining. */
const LEGACY_ESTABLISHMENT_ONLY = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        // Cap proof wait at link establishment timeout (6s × hops). Otherwise a
        // cached path lets wait_for_proof burn the entire overall deadline
        // (e.g. TCP 45s) even when MeshChat would fail the link stage in ~15s.
        let proof_budget = time_remaining(deadline)?.min(link.establishment_timeout);
        let proof_data = wait_for_proof(&mut dest_rx, link_id, proof_budget).await?;
        Ok(())
    }
}
`;

/** Intermediate 30s-floor cap — must migrate to remaining. */
const LEGACY_THIRTY_FLOOR = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        // Cap proof wait at establishment (6s × hops), but floor at 30s so slow
        // TCP hub LRPROOFs can succeed under the MeshChat 45s overall
        // (45 − 15s transfer grace). Still capped by time remaining.
        let proof_budget = time_remaining(deadline)?.min(
            link.establishment_timeout
                .max(Duration::from_secs(30)),
        );
        let proof_data = wait_for_proof(&mut dest_rx, link_id, proof_budget).await?;
        Ok(())
    }
}
`;

const INCOMPATIBLE = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        let proof_data = wait_for_proof(&mut dest_rx, link_id, Duration::from_secs(99)).await?;
        Ok(())
    }
}
`;

/** Caps proof_budget but wait_for_proof still uses the uncapped remaining deadline. */
const CAPPED_PROOF_BUDGET_UNUSED = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        let proof_budget = time_remaining(deadline)?;
        let proof_data = wait_for_proof(&mut dest_rx, link_id, time_remaining(deadline)?).await?;
        Ok(())
    }
}
`;

const temps = [];

function makeFakeRsReticulum(linkClientSource) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'mesh-proof-budget-rns-'));
  temps.push(root);
  const linkClientPath = path.join(root, 'crates/rns-runtime/src/link_client.rs');
  mkdirSync(path.dirname(linkClientPath), { recursive: true });
  writeFileSync(linkClientPath, linkClientSource);
  const gitInit = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  expect(gitInit.status).toBe(0);
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: root });
  spawnSync('git', ['add', '.'], { cwd: root });
  const commit = spawnSync('git', ['commit', '-m', 'init'], { cwd: root, encoding: 'utf8' });
  expect(commit.status).toBe(0);
  return root;
}

function runApply(rnsDir) {
  return spawnSync('bash', [APPLY_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, RS_RETICULUM_DIR: rnsDir },
  });
}

afterEach(() => {
  while (temps.length > 0) {
    const dir = temps.pop();
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('apply-rsReticulum-link-client-proof-budget.sh', () => {
  it('applies the overlay on a fresh checkout', () => {
    expect(readFileSync(PATCH_FILE, 'utf8')).toContain('proof_budget');
    expect(readFileSync(PATCH_FILE, 'utf8')).toContain('time_remaining(deadline)?');
    const rns = makeFakeRsReticulum(FRESH_LINK_CLIENT);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/applied .*rsReticulum-link-client-proof-budget\.patch/);
    const body = readFileSync(path.join(rns, 'crates/rns-runtime/src/link_client.rs'), 'utf8');
    expect(body).toContain('let proof_budget = time_remaining(deadline)?;');
    expect(body).toContain('wait_for_proof(&mut dest_rx, link_id, proof_budget)');
  });

  it('is a no-op when the exact overlay is already applied (repeated run)', () => {
    const rns = makeFakeRsReticulum(FRESH_LINK_CLIENT);
    const first = runApply(rns);
    expect(first.status, first.stderr || first.stdout).toBe(0);
    const second = runApply(rns);
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(second.stdout).toMatch(/already present|already upstream/);
  });

  it('migrates the legacy establishment-only cap to remaining-deadline', () => {
    const rns = makeFakeRsReticulum(LEGACY_ESTABLISHMENT_ONLY);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/migrated .*remaining-deadline/);
    const body = readFileSync(path.join(rns, 'crates/rns-runtime/src/link_client.rs'), 'utf8');
    expect(body).toContain('let proof_budget = time_remaining(deadline)?;');
    expect(body).not.toMatch(/\.min\(link\.establishment_timeout\)/);
  });

  it('migrates the legacy 30s floor cap to remaining-deadline', () => {
    const rns = makeFakeRsReticulum(LEGACY_THIRTY_FLOOR);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/migrated .*remaining-deadline|already upstream/);
    const body = readFileSync(path.join(rns, 'crates/rns-runtime/src/link_client.rs'), 'utf8');
    expect(body).toContain('let proof_budget = time_remaining(deadline)?;');
    expect(body).not.toContain('Duration::from_secs(30)');
  });

  it('accepts an upstream-equivalent remaining proof budget when the patch does not apply', () => {
    const rns = makeFakeRsReticulum(UPSTREAM_EQUIVALENT);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already upstream|already present/);
  });

  it('is a no-op when upstream wait_for_valid_proof uses remaining deadline', () => {
    const rns = makeFakeRsReticulum(UPSTREAM_VALID_PROOF);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already upstream|already present/);
  });

  it('rejects a proof_budget that wait_for_proof does not use', () => {
    const rns = makeFakeRsReticulum(CAPPED_PROOF_BUDGET_UNUSED);
    const result = runApply(rns);
    // Assignment is remaining but wait_for_proof ignores proof_budget — not acceptable.
    expect(result.status).not.toBe(0);
  });

  it('fails with git diagnostic on incompatible checkouts', () => {
    const rns = makeFakeRsReticulum(INCOMPATIBLE);
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/could not be applied|git diagnostic/i);
  });
});
