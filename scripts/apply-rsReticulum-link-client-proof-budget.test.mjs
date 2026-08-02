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
        // Cap proof wait at establishment (6s × hops), but floor at 30s.
        let proof_budget = time_remaining(deadline)?.min(
            link.establishment_timeout
                .max(Duration::from_secs(30)),
        );
        let proof_data = wait_for_proof(&mut dest_rx, link_id, proof_budget).await?;
        Ok(())
    }
}
`;

/** Older #756 establishment-only cap — apply script must migrate to the 30s floor. */
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

const INCOMPATIBLE = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        let proof_data = wait_for_proof(&mut dest_rx, link_id, Duration::from_secs(99)).await?;
        Ok(())
    }
}
`;

/** Has proof_budget but does not cap/floor it. */
const UNCAPPED_PROOF_BUDGET = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        let proof_budget = time_remaining(deadline)?;
        let proof_data = wait_for_proof(&mut dest_rx, link_id, proof_budget).await?;
        Ok(())
    }
}
`;

/** Caps proof_budget but wait_for_proof still uses the uncapped remaining deadline. */
const CAPPED_PROOF_BUDGET_UNUSED = `impl LinkClient {
    async fn query(&self) -> Result<(), LinkClientError> {
        let proof_budget = time_remaining(deadline)?.min(
            link.establishment_timeout.max(Duration::from_secs(30)),
        );
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
    expect(readFileSync(PATCH_FILE, 'utf8')).toContain('Duration::from_secs(30)');
    const rns = makeFakeRsReticulum(FRESH_LINK_CLIENT);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/applied .*rsReticulum-link-client-proof-budget\.patch/);
    const body = readFileSync(path.join(rns, 'crates/rns-runtime/src/link_client.rs'), 'utf8');
    expect(body).toContain('let proof_budget');
    expect(body).toContain('link.establishment_timeout');
    expect(body).toContain('Duration::from_secs(30)');
  });

  it('is a no-op when the exact overlay is already applied (repeated run)', () => {
    const rns = makeFakeRsReticulum(FRESH_LINK_CLIENT);
    const first = runApply(rns);
    expect(first.status, first.stderr || first.stdout).toBe(0);
    const second = runApply(rns);
    expect(second.status, second.stderr || second.stdout).toBe(0);
    expect(second.stdout).toMatch(/already present/);
  });

  it('migrates the legacy establishment-only cap to the 30s floor', () => {
    const rns = makeFakeRsReticulum(LEGACY_ESTABLISHMENT_ONLY);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/migrated .*30s floor/);
    const body = readFileSync(path.join(rns, 'crates/rns-runtime/src/link_client.rs'), 'utf8');
    expect(body).toContain('Duration::from_secs(30)');
    expect(body).not.toMatch(
      /let proof_budget = time_remaining\(deadline\)\?\.min\(link\.establishment_timeout\);/,
    );
  });

  it('accepts an upstream-equivalent proof-budget floor when the patch does not apply', () => {
    const rns = makeFakeRsReticulum(UPSTREAM_EQUIVALENT);
    const result = runApply(rns);
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(result.stdout).toMatch(/already upstream/);
  });

  it('rejects an uncapped proof_budget as upstream-equivalent', () => {
    const rns = makeFakeRsReticulum(UNCAPPED_PROOF_BUDGET);
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/could not be applied|git diagnostic/i);
  });

  it('rejects a capped proof_budget that wait_for_proof does not use', () => {
    const rns = makeFakeRsReticulum(CAPPED_PROOF_BUDGET_UNUSED);
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/could not be applied|git diagnostic/i);
  });

  it('fails with git diagnostic on incompatible checkouts', () => {
    const rns = makeFakeRsReticulum(INCOMPATIBLE);
    const result = runApply(rns);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/could not be applied|git diagnostic/i);
  });
});
