// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FLATPAK_ATTESTATION_PREDICATE_TYPE,
  FLATPAK_BUILDER_IMAGE,
  FLATPAK_RELEASE_BUNDLES,
  buildGithubAttestationVerifyArgs,
  collectReleaseBundleDigests,
  createFlatpakBuilderPredicate,
  flatpakGeneratorRequirementsSha256,
  parseNamedArgs,
  verifyFlatpakReleaseProvenance,
  verifyGithubFlatpakAttestation,
} from './flatpak-builder-provenance.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeBundles() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mesh-flatpak-provenance-'));
  tempDirs.push(dir);
  for (const [index, name] of FLATPAK_RELEASE_BUNDLES.entries()) {
    writeFileSync(path.join(dir, name), `bundle-${index}`);
  }
  return dir;
}

function digest(text) {
  return createHash('sha256').update(text).digest('hex');
}

function verifiedResult(overrides = {}) {
  const predicate = createFlatpakBuilderPredicate({
    sourceSha: SOURCE_SHA,
    builderImage: FLATPAK_BUILDER_IMAGE,
  });
  return [
    {
      verificationResult: {
        statement: {
          predicateType: FLATPAK_ATTESTATION_PREDICATE_TYPE,
          predicate,
          subject: [
            { name: FLATPAK_RELEASE_BUNDLES[0], digest: { sha256: digest('bundle-0') } },
            { name: FLATPAK_RELEASE_BUNDLES[1], digest: { sha256: digest('bundle-1') } },
          ],
          ...overrides,
        },
      },
    },
  ];
}

describe('Flatpak builder provenance', () => {
  it('pins the reviewed multi-architecture OCI index', () => {
    expect(FLATPAK_BUILDER_IMAGE).toBe(
      'ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08@sha256:66eb59fd5d923833e8e4142f60e542156aad4b8b1d5db38149d814c659e274bc',
    );
  });

  it('creates an exact predicate for the reviewed source and builder', () => {
    expect(
      createFlatpakBuilderPredicate({
        sourceSha: SOURCE_SHA,
        builderImage: FLATPAK_BUILDER_IMAGE,
      }),
    ).toEqual({
      builder: { image: FLATPAK_BUILDER_IMAGE, privileged: true },
      source: {
        repository: 'https://github.com/Colorado-Mesh/mesh-client',
        commit: SOURCE_SHA,
      },
      workflow: 'Colorado-Mesh/mesh-client/.github/workflows/flatpak.yaml',
      architectures: ['aarch64', 'x86_64'],
      generator: { requirementsSha256: flatpakGeneratorRequirementsSha256() },
    });
  });

  it('rejects another digest, a tag-only image, and malformed source SHAs', () => {
    expect(() =>
      createFlatpakBuilderPredicate({
        sourceSha: SOURCE_SHA,
        builderImage: `${FLATPAK_BUILDER_IMAGE.slice(0, -64)}${'b'.repeat(64)}`,
      }),
    ).toThrow(/unexpected Flatpak builder image/);
    expect(() =>
      createFlatpakBuilderPredicate({
        sourceSha: SOURCE_SHA,
        builderImage: 'ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08',
      }),
    ).toThrow(/unexpected Flatpak builder image/);
    expect(() =>
      createFlatpakBuilderPredicate({
        sourceSha: 'ABC',
        builderImage: FLATPAK_BUILDER_IMAGE,
      }),
    ).toThrow(/source SHA/);
  });

  it('hashes exactly the two final release bundle names', async () => {
    const dir = makeBundles();
    await expect(collectReleaseBundleDigests(dir)).resolves.toEqual([
      { name: FLATPAK_RELEASE_BUNDLES[0], sha256: digest('bundle-0') },
      { name: FLATPAK_RELEASE_BUNDLES[1], sha256: digest('bundle-1') },
    ]);
  });

  it('fails when either release architecture is absent', async () => {
    const dir = makeBundles();
    rmSync(path.join(dir, FLATPAK_RELEASE_BUNDLES[1]));
    await expect(collectReleaseBundleDigests(dir)).rejects.toThrow(/missing release Flatpak/);
  });

  it('accepts a verified statement only when both final digests match', async () => {
    const bundleDir = makeBundles();
    await expect(
      verifyFlatpakReleaseProvenance(verifiedResult(), {
        bundleDir,
        sourceSha: SOURCE_SHA,
        builderImage: FLATPAK_BUILDER_IMAGE,
      }),
    ).resolves.toHaveLength(2);
  });

  it.each([
    ['no results', [], /no verified/],
    [
      'wrong predicate type',
      verifiedResult({ predicateType: 'https://example.invalid/predicate' }),
      /exactly one verified/,
    ],
    [
      'wrong source',
      verifiedResult({
        predicate: createFlatpakBuilderPredicate({
          sourceSha: 'b'.repeat(40),
          builderImage: FLATPAK_BUILDER_IMAGE,
        }),
      }),
      /predicate does not match/,
    ],
    ['missing subject', verifiedResult({ subject: [] }), /subjects do not match/],
    [
      'wrong digest',
      verifiedResult({
        subject: FLATPAK_RELEASE_BUNDLES.map((name) => ({
          name,
          digest: { sha256: 'c'.repeat(64) },
        })),
      }),
      /subjects do not match/,
    ],
  ])('rejects %s', async (_label, results, message) => {
    const bundleDir = makeBundles();
    await expect(
      verifyFlatpakReleaseProvenance(results, {
        bundleDir,
        sourceSha: SOURCE_SHA,
        builderImage: FLATPAK_BUILDER_IMAGE,
      }),
    ).rejects.toThrow(message);
  });

  it('rejects missing, duplicate, and unknown CLI arguments', () => {
    expect(() => parseNamedArgs([], new Set(['output']))).toThrow(/missing required/);
    expect(() => parseNamedArgs(['--output', 'a', '--output', 'b'], new Set(['output']))).toThrow(
      /duplicate/,
    );
    expect(() => parseNamedArgs(['--wat', 'a'], new Set(['output']))).toThrow(/unknown/);
  });

  it('builds a closed, exact GitHub attestation verification command', () => {
    const bundleDir = '/tmp/flatpak-bundles';
    const attestationBundle = '/tmp/flatpak-attestation.json';
    expect(
      buildGithubAttestationVerifyArgs({
        bundleDir,
        attestationBundle,
        sourceSha: SOURCE_SHA,
        sourceRef: 'refs/tags/v1.2.3',
        repository: 'Colorado-Mesh/mesh-client',
      }),
    ).toEqual([
      'attestation',
      'verify',
      path.join(bundleDir, FLATPAK_RELEASE_BUNDLES[1]),
      '--repo',
      'Colorado-Mesh/mesh-client',
      '--bundle',
      attestationBundle,
      '--predicate-type',
      FLATPAK_ATTESTATION_PREDICATE_TYPE,
      '--signer-workflow',
      'Colorado-Mesh/mesh-client/.github/workflows/flatpak.yaml',
      '--source-digest',
      SOURCE_SHA,
      '--source-ref',
      'refs/tags/v1.2.3',
      '--deny-self-hosted-runners',
      '--format',
      'json',
    ]);
  });

  it('rejects verification command overrides for repository and source ref', () => {
    const base = {
      bundleDir: '/tmp/flatpak-bundles',
      attestationBundle: '/tmp/flatpak-attestation.json',
      sourceSha: SOURCE_SHA,
      sourceRef: 'refs/tags/v1.2.3',
      repository: 'Colorado-Mesh/mesh-client',
    };
    expect(() =>
      buildGithubAttestationVerifyArgs({ ...base, repository: 'attacker/repository' }),
    ).toThrow(/unexpected GitHub repository/);
    expect(() =>
      buildGithubAttestationVerifyArgs({ ...base, sourceRef: 'refs/heads/main' }),
    ).toThrow(/version tag ref/);
  });

  it('verifies with gh before copying the attestation into the release set', async () => {
    const bundleDir = makeBundles();
    const attestationBundle = path.join(bundleDir, 'generated.sigstore.json');
    const releaseAttestation = path.join(bundleDir, 'release.sigstore.json');
    writeFileSync(attestationBundle, 'signed-bundle');
    let capturedArgs;
    await expect(
      verifyGithubFlatpakAttestation({
        bundleDir,
        attestationBundle,
        releaseAttestation,
        sourceSha: SOURCE_SHA,
        sourceRef: 'refs/tags/v1.2.3',
        builderImage: FLATPAK_BUILDER_IMAGE,
        repository: 'Colorado-Mesh/mesh-client',
        runGh(args) {
          capturedArgs = args;
          return { status: 0, stdout: JSON.stringify(verifiedResult()) };
        },
      }),
    ).resolves.toHaveLength(2);
    expect(capturedArgs).toEqual(
      buildGithubAttestationVerifyArgs({
        bundleDir,
        attestationBundle: releaseAttestation,
        sourceSha: SOURCE_SHA,
        sourceRef: 'refs/tags/v1.2.3',
        repository: 'Colorado-Mesh/mesh-client',
      }),
    );
    expect(readFileSync(releaseAttestation, 'utf8')).toBe('signed-bundle');
  });

  it('does not publish a failed or malformed GitHub attestation result', async () => {
    const bundleDir = makeBundles();
    const attestationBundle = path.join(bundleDir, 'generated.sigstore.json');
    const releaseAttestation = path.join(bundleDir, 'release.sigstore.json');
    writeFileSync(attestationBundle, 'signed-bundle');
    const input = {
      bundleDir,
      attestationBundle,
      releaseAttestation,
      sourceSha: SOURCE_SHA,
      sourceRef: 'refs/tags/v1.2.3',
      builderImage: FLATPAK_BUILDER_IMAGE,
      repository: 'Colorado-Mesh/mesh-client',
    };
    await expect(
      verifyGithubFlatpakAttestation({
        ...input,
        runGh: () => ({ status: 1, stderr: 'signature mismatch' }),
      }),
    ).rejects.toThrow(/signature mismatch/);
    await expect(
      verifyGithubFlatpakAttestation({
        ...input,
        runGh: () => ({ status: 0, stdout: 'not-json' }),
      }),
    ).rejects.toThrow(/invalid JSON/);
    expect(() => readFileSync(releaseAttestation, 'utf8')).toThrow();
  });
});
