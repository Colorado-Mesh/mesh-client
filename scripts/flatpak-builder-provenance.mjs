#!/usr/bin/env node
/**
 * Build and verify the signed custom predicate used for release Flatpaks.
 *
 * The privileged build job creates the bundles. The bare publish job hashes the
 * final, arch-suffixed files, signs this predicate with GitHub OIDC via
 * actions/attest, verifies that signature with gh, and only then uploads.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  constants as fsConstants,
  createReadStream,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const FLATPAK_BUILDER_IMAGE =
  'ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08@sha256:66eb59fd5d923833e8e4142f60e542156aad4b8b1d5db38149d814c659e274bc';
export const FLATPAK_ATTESTATION_PREDICATE_TYPE =
  'https://github.com/Colorado-Mesh/mesh-client/attestations/flatpak-builder/v1';
export const FLATPAK_ATTEST_ACTION = 'actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6';
export const FLATPAK_SIGNER_WORKFLOW = 'Colorado-Mesh/mesh-client/.github/workflows/flatpak.yaml';
export const FLATPAK_SOURCE_REPOSITORY = 'https://github.com/Colorado-Mesh/mesh-client';
export const FLATPAK_GITHUB_REPOSITORY = 'Colorado-Mesh/mesh-client';
export const FLATPAK_RELEASE_BUNDLES = Object.freeze([
  'org.coloradomesh.MeshClient.flatpak-aarch64.flatpak',
  'org.coloradomesh.MeshClient.flatpak-x86_64.flatpak',
]);

const SOURCE_SHA_RE = /^[a-f0-9]{40}$/;
const MAX_VERIFICATION_RESULT_BYTES = 8 * 1024 * 1024;
const GENERATOR_REQUIREMENTS_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'requirements-flatpak-generator.txt',
);

/** SHA-256 of the committed hash-locked generator requirements file. */
export function flatpakGeneratorRequirementsSha256() {
  return createHash('sha256').update(readFileSync(GENERATOR_REQUIREMENTS_PATH)).digest('hex');
}

/** @param {string} sourceSha */
export function assertSourceSha(sourceSha) {
  if (!SOURCE_SHA_RE.test(sourceSha)) {
    throw new Error('source SHA must be a lowercase 40-character Git commit');
  }
  return sourceSha;
}

/** @param {string} builderImage */
export function assertReviewedBuilderImage(builderImage) {
  if (builderImage !== FLATPAK_BUILDER_IMAGE) {
    throw new Error(`unexpected Flatpak builder image: ${builderImage}`);
  }
  return builderImage;
}

/**
 * @param {{ sourceSha: string, builderImage: string }} input
 */
export function createFlatpakBuilderPredicate(input) {
  const sourceSha = assertSourceSha(input.sourceSha);
  const builderImage = assertReviewedBuilderImage(input.builderImage);
  return {
    builder: {
      image: builderImage,
      privileged: true,
    },
    source: {
      repository: FLATPAK_SOURCE_REPOSITORY,
      commit: sourceSha,
    },
    workflow: FLATPAK_SIGNER_WORKFLOW,
    architectures: ['aarch64', 'x86_64'],
    generator: {
      requirementsSha256: flatpakGeneratorRequirementsSha256(),
    },
  };
}

/** @param {string} filePath */
export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * @param {string} bundleDir
 * @returns {Promise<Array<{ name: string, sha256: string }>>}
 */
export async function collectReleaseBundleDigests(bundleDir) {
  const records = [];
  for (const name of FLATPAK_RELEASE_BUNDLES) {
    const filePath = path.join(bundleDir, name);
    let stats;
    try {
      stats = statSync(filePath);
    } catch {
      throw new Error(`missing release Flatpak: ${name}`);
    }
    if (!stats.isFile()) {
      throw new Error(`release Flatpak is not a regular file: ${name}`);
    }
    records.push({ name, sha256: await sha256File(filePath) });
  }
  return records;
}

/** @param {unknown} value */
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate the JSON emitted by `gh attestation verify --format json` and bind
 * every final release filename to its freshly computed digest.
 *
 * @param {unknown} rawResults
 * @param {{ bundleDir: string, sourceSha: string, builderImage: string }} expected
 */
export async function verifyFlatpakReleaseProvenance(rawResults, expected) {
  const wantedPredicate = createFlatpakBuilderPredicate(expected);
  const bundleDigests = await collectReleaseBundleDigests(expected.bundleDir);
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    throw new Error('no verified Flatpak attestation results');
  }

  const matchingStatements = rawResults
    .map((entry) => (isRecord(entry) ? entry.verificationResult : null))
    .map((result) => (isRecord(result) ? result.statement : null))
    .filter(
      (statement) =>
        isRecord(statement) && statement.predicateType === FLATPAK_ATTESTATION_PREDICATE_TYPE,
    );
  if (matchingStatements.length !== 1) {
    throw new Error('expected exactly one verified Flatpak provenance statement');
  }

  const statement = matchingStatements[0];
  if (!isDeepStrictEqual(statement.predicate, wantedPredicate)) {
    throw new Error('Flatpak provenance predicate does not match reviewed source and builder');
  }
  if (!Array.isArray(statement.subject)) {
    throw new Error('Flatpak provenance statement is missing subjects');
  }

  const actualSubjects = statement.subject
    .map((subject) => {
      if (!isRecord(subject) || typeof subject.name !== 'string' || !isRecord(subject.digest)) {
        throw new Error('Flatpak provenance contains a malformed subject');
      }
      const sha256 = subject.digest.sha256;
      if (typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) {
        throw new Error(`Flatpak provenance has an invalid SHA-256 for ${subject.name}`);
      }
      return { name: subject.name, sha256 };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!isDeepStrictEqual(actualSubjects, bundleDigests)) {
    throw new Error('Flatpak provenance subjects do not match final release bundle digests');
  }
  return bundleDigests;
}

/**
 * Read one bounded regular file through the same descriptor used for metadata
 * checks. Rechecking the descriptor rejects concurrent mutation while reading.
 *
 * @param {string} filePath
 * @param {string} label
 */
export function readBoundedRegularFile(filePath, label) {
  const fd = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(MAX_VERIFICATION_RESULT_BYTES)) {
      throw new Error(`${label} is missing, invalid, or too large`);
    }
    const checkedSize = Number(before.size);
    const contents = Buffer.alloc(checkedSize);
    let offset = 0;
    while (offset < checkedSize) {
      const bytesRead = readSync(fd, contents, offset, checkedSize - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const grewPastCheckedSize = readSync(fd, Buffer.alloc(1), 0, 1, checkedSize) !== 0;
    const after = fstatSync(fd, { bigint: true });
    if (
      offset !== checkedSize ||
      grewPastCheckedSize ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs ||
      BigInt(contents.length) !== after.size
    ) {
      throw new Error(`${label} changed while it was being read`);
    }
    return contents;
  } finally {
    closeSync(fd);
  }
}

/** @param {string} filePath */
export function readVerificationResults(filePath) {
  return JSON.parse(
    readBoundedRegularFile(filePath, 'Flatpak verification results').toString('utf8'),
  );
}

/**
 * @param {{
 *   bundleDir: string,
 *   attestationBundle: string,
 *   sourceSha: string,
 *   sourceRef: string,
 *   repository: string,
 * }} input
 */
export function buildGithubAttestationVerifyArgs(input) {
  const sourceSha = assertSourceSha(input.sourceSha);
  if (input.repository !== FLATPAK_GITHUB_REPOSITORY) {
    throw new Error(`unexpected GitHub repository: ${input.repository}`);
  }
  if (!/^refs\/tags\/v[^\s]+$/.test(input.sourceRef)) {
    throw new Error(`Flatpak release attestation requires a version tag ref: ${input.sourceRef}`);
  }
  const subjectPath = path.join(input.bundleDir, FLATPAK_RELEASE_BUNDLES[1]);
  return [
    'attestation',
    'verify',
    subjectPath,
    '--repo',
    input.repository,
    '--bundle',
    input.attestationBundle,
    '--predicate-type',
    FLATPAK_ATTESTATION_PREDICATE_TYPE,
    '--signer-workflow',
    FLATPAK_SIGNER_WORKFLOW,
    '--source-digest',
    sourceSha,
    '--source-ref',
    input.sourceRef,
    '--deny-self-hosted-runners',
    '--format',
    'json',
  ];
}

/**
 * @param {{
 *   bundleDir: string,
 *   attestationBundle: string,
 *   releaseAttestation: string,
 *   sourceSha: string,
 *   sourceRef: string,
 *   builderImage: string,
 *   repository: string,
 *   runGh?: (args: string[]) => { status: number | null, stdout?: string, stderr?: string, error?: Error },
 * }} input
 */
export async function verifyGithubFlatpakAttestation(input) {
  assertReviewedBuilderImage(input.builderImage);
  const attestationBytes = readBoundedRegularFile(
    input.attestationBundle,
    'Sigstore attestation bundle',
  );
  let snapshotCreated = false;
  try {
    writeFileSync(input.releaseAttestation, attestationBytes, { flag: 'wx', mode: 0o400 });
    snapshotCreated = true;
    const args = buildGithubAttestationVerifyArgs({
      ...input,
      attestationBundle: input.releaseAttestation,
    });
    const runGh =
      input.runGh ??
      ((ghArgs) =>
        spawnSync('gh', ghArgs, {
          encoding: 'utf8',
          maxBuffer: MAX_VERIFICATION_RESULT_BYTES,
        }));
    const result = runGh(args);
    if (result.error || result.status !== 0) {
      const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${result.status}`;
      throw new Error(`GitHub attestation verification failed: ${detail}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(result.stdout ?? '');
    } catch {
      throw new Error('GitHub attestation verification returned invalid JSON');
    }
    const records = await verifyFlatpakReleaseProvenance(parsed, input);
    snapshotCreated = false;
    return records;
  } finally {
    if (snapshotCreated) rmSync(input.releaseAttestation, { force: true });
  }
}

/**
 * @param {string[]} argv
 * @param {Set<string>} allowed
 */
export function parseNamedArgs(argv, allowed) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined || value.startsWith('--')) {
      throw new Error(`invalid argument near ${key ?? '<end>'}`);
    }
    const name = key.slice(2);
    if (!allowed.has(name) || values.has(name)) {
      throw new Error(`unknown or duplicate argument: ${key}`);
    }
    values.set(name, value);
  }
  for (const name of allowed) {
    if (!values.has(name)) throw new Error(`missing required argument: --${name}`);
  }
  return Object.fromEntries(values);
}

async function main() {
  const [command, ...argv] = process.argv.slice(2);
  if (command === 'write-predicate') {
    const args = parseNamedArgs(argv, new Set(['output', 'source-sha', 'builder-image']));
    const predicate = createFlatpakBuilderPredicate({
      sourceSha: args['source-sha'],
      builderImage: args['builder-image'],
    });
    writeFileSync(args.output, `${JSON.stringify(predicate, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    return;
  }

  if (command === 'verify') {
    const args = parseNamedArgs(
      argv,
      new Set(['result', 'bundle-dir', 'source-sha', 'builder-image']),
    );
    await verifyFlatpakReleaseProvenance(readVerificationResults(args.result), {
      bundleDir: args['bundle-dir'],
      sourceSha: args['source-sha'],
      builderImage: args['builder-image'],
    });
    return;
  }

  if (command === 'verify-github') {
    if (argv.length > 0) throw new Error('verify-github does not accept command-line overrides');
    await verifyGithubFlatpakAttestation({
      bundleDir: 'flatpak-dist',
      attestationBundle: process.env.ATTESTATION_BUNDLE_PATH ?? '',
      releaseAttestation: 'flatpak-dist/mesh-client-flatpak-attestation.sigstore.json',
      sourceSha: process.env.GITHUB_SHA ?? '',
      sourceRef: process.env.GITHUB_REF ?? '',
      builderImage: process.env.FLATPAK_BUILDER_IMAGE ?? '',
      repository: process.env.GITHUB_REPOSITORY ?? '',
    });
    return;
  }

  throw new Error(
    'usage: flatpak-builder-provenance.mjs <write-predicate|verify|verify-github> --...',
  );
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (entry && import.meta.url === entry) {
  main().catch((error) => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[flatpak-builder-provenance] ${detail}`);
    process.exit(1);
  });
}
