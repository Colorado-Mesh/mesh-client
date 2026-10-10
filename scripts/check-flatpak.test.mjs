// @vitest-environment node
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  flatpakCiPathFilterViolations,
  flatpakWorkflowBuilderProvenanceViolations,
  flatpakWorkflowSidecarExecutableContractViolations,
  flatpakWorkflowTestBuildContractViolations,
  manifestCiBuildInfoExportViolations,
} from './check-flatpak.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('manifestCiBuildInfoExportViolations', () => {
  it('accepts the real Flatpak manifest', () => {
    const doc = yaml.load(
      fs.readFileSync(path.join(ROOT, 'org.coloradomesh.MeshClient.yml'), 'utf8'),
    );
    expect(manifestCiBuildInfoExportViolations(doc, 'manifest')).toEqual([]);
  });

  it('rejects when export lives only in comments / decoy text (not build-commands)', () => {
    const doc = {
      modules: [
        {
          name: 'mesh-client',
          'build-commands': [
            // Unrelated decoy that a raw-text search for MESH_CLIENT_BUILD_INFO might hit
            'echo "see docs: MESH_CLIENT_BUILD_INFO / flatpak/ci-build-info.json"',
            'pnpm run build',
          ],
        },
      ],
    };
    const violations = manifestCiBuildInfoExportViolations(doc, 'fake.yml');
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0].message).toMatch(/MESH_CLIENT_BUILD_INFO/);
  });

  it('rejects missing mesh-client module', () => {
    expect(manifestCiBuildInfoExportViolations({ modules: [] }, 'fake.yml')).toEqual([
      {
        file: 'fake.yml',
        message: 'manifest must include a mesh-client module',
      },
    ]);
  });
});

describe('flatpakWorkflowTestBuildContractViolations', () => {
  it('accepts the real flatpak workflow', () => {
    const doc = yaml.load(
      fs.readFileSync(path.join(ROOT, '.github/workflows/flatpak.yaml'), 'utf8'),
    );
    expect(flatpakWorkflowTestBuildContractViolations(doc, 'flatpak.yaml')).toEqual([]);
  });

  it('ignores commented-out and unrelated string matches in raw YAML text', () => {
    // Parsed document has no writer/rename/deferred-upload steps — only decoy strings
    // that a raw-text search would falsely accept.
    const doc = {
      'run-name': 'Build Flatpak',
      jobs: {
        flatpak: {
          steps: [
            {
              name: 'decoy',
              run: '# write-flatpak-ci-build-info.mjs\necho rename-test-build-artifacts.mjs --flatpak',
            },
            {
              uses: 'flatpak/flatpak-github-actions/flatpak-builder@deadbeef',
              with: {
                // Comment-like decoy key must not satisfy upload-artifact: false
                'upload-artifact-comment': 'false',
              },
            },
          ],
        },
      },
    };
    const violations = flatpakWorkflowTestBuildContractViolations(doc, 'fake.yaml');
    expect(violations.map((v) => v.message).join('\n')).toMatch(/Build Flatpak \(no release\)/);
    expect(violations.map((v) => v.message).join('\n')).toMatch(/write-flatpak-ci-build-info/);
    expect(violations.map((v) => v.message).join('\n')).toMatch(/upload-artifact: false/);
    expect(violations.map((v) => v.message).join('\n')).toMatch(/rename-test-build-artifacts/);
  });
});

describe('flatpakWorkflowSidecarExecutableContractViolations', () => {
  it('accepts the real flatpak workflow', () => {
    const doc = yaml.load(
      fs.readFileSync(path.join(ROOT, '.github/workflows/flatpak.yaml'), 'utf8'),
    );
    expect(flatpakWorkflowSidecarExecutableContractViolations(doc, 'flatpak.yaml')).toEqual([]);
  });

  it('rejects raw binary upload and test -f smoke', () => {
    const doc = {
      jobs: {
        'reticulum-sidecar': {
          steps: [
            {
              run: 'install -Dm755 target/release/mesh-client-reticulum resources/reticulum-sidecar/mesh-client-reticulum',
            },
            {
              uses: 'actions/upload-artifact@v7',
              with: { path: 'resources/reticulum-sidecar/mesh-client-reticulum' },
            },
          ],
        },
        flatpak: {
          steps: [
            {
              run: `flatpak run --command=sh org.coloradomesh.MeshClient -c '
            test -f /app/lib/mesh-client/resources/reticulum-sidecar/mesh-client-reticulum'`,
            },
          ],
        },
      },
    };
    const messages = flatpakWorkflowSidecarExecutableContractViolations(doc, 'fake.yaml').map(
      (v) => v.message,
    );
    expect(messages.join('\n')).toMatch(/tar the sidecar/);
    expect(messages.join('\n')).toMatch(/\.tar artifact/);
    expect(messages.join('\n')).toMatch(/tar -xf/);
    expect(messages.join('\n')).toMatch(/test -x/);
  });
});

describe('flatpakWorkflowBuilderProvenanceViolations', () => {
  function realWorkflow() {
    return yaml.load(fs.readFileSync(path.join(ROOT, '.github/workflows/flatpak.yaml'), 'utf8'));
  }

  it('accepts the pinned, signed, fail-closed real workflow', () => {
    expect(flatpakWorkflowBuilderProvenanceViolations(realWorkflow(), 'flatpak.yaml')).toEqual([]);
  });

  it.each([
    ['tag-only image', 'ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08'],
    [
      'attacker-selected digest',
      `ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08@sha256:${'b'.repeat(64)}`,
    ],
    ['dynamic expression', '${{ env.ATTACKER_IMAGE }}'],
    [
      'single-architecture manifest',
      `ghcr.io/flathub-infra/flatpak-github-actions:freedesktop-24.08@sha256:${'9'.repeat(64)}`,
    ],
  ])('rejects %s for the privileged builder', (_label, image) => {
    const doc = realWorkflow();
    doc.jobs.flatpak.container.image = image;
    const messages = flatpakWorkflowBuilderProvenanceViolations(doc, 'fake.yaml').map(
      (violation) => violation.message,
    );
    expect(messages.join('\n')).toMatch(/reviewed OCI index/);
  });

  it('rejects a mutable or decoy attestation action', () => {
    const doc = realWorkflow();
    const actionStep = doc.jobs.publish.steps.find((step) => step.id === 'flatpak_attestation');
    actionStep.uses = 'actions/attest@v4';
    actionStep.run =
      '# actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6\n' +
      'echo gh attestation verify --deny-self-hosted-runners';
    const messages = flatpakWorkflowBuilderProvenanceViolations(doc, 'fake.yaml').map(
      (violation) => violation.message,
    );
    expect(messages.join('\n')).toMatch(/sign both Flatpaks/);
  });

  it('rejects missing verification and upload of the signed bundle', () => {
    const doc = realWorkflow();
    doc.jobs.publish.steps = doc.jobs.publish.steps.filter(
      (step) =>
        step.name !== 'Verify signed Flatpak provenance and bundle digests' &&
        step.name !== 'Attach Flatpak to draft release',
    );
    const messages = flatpakWorkflowBuilderProvenanceViolations(doc, 'fake.yaml').map(
      (violation) => violation.message,
    );
    expect(messages.join('\n')).toMatch(/verify signer, source, predicate/);
    expect(messages.join('\n')).toMatch(/attach verified Flatpaks/);
  });

  it('rejects release upload before provenance verification', () => {
    const doc = realWorkflow();
    const steps = doc.jobs.publish.steps;
    const verifyIndex = steps.findIndex(
      (step) => step.name === 'Verify signed Flatpak provenance and bundle digests',
    );
    const uploadIndex = steps.findIndex((step) => step.name === 'Attach Flatpak to draft release');
    [steps[verifyIndex], steps[uploadIndex]] = [steps[uploadIndex], steps[verifyIndex]];
    const messages = flatpakWorkflowBuilderProvenanceViolations(doc, 'fake.yaml').map(
      (violation) => violation.message,
    );
    expect(messages.join('\n')).toMatch(/predicate, sign, verify, then release upload/);
  });
});

describe('flatpakCiPathFilterViolations', () => {
  function realCiWorkflow() {
    return yaml.load(fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yaml'), 'utf8'));
  }

  it('accepts the real CI path filter', () => {
    expect(flatpakCiPathFilterViolations(realCiWorkflow(), 'ci.yaml')).toEqual([]);
  });

  it.each([
    '.github/workflows/flatpak.yaml',
    'scripts/flatpak-builder-provenance*.mjs',
    'scripts/run-act.mjs',
  ])('rejects omission of %s', (requiredPath) => {
    const doc = realCiWorkflow();
    const filter = doc.jobs.changes.steps.find((step) => step.id === 'filter');
    const parsed = yaml.load(filter.with.filters);
    parsed.flatpak = parsed.flatpak.filter((entry) => entry !== requiredPath);
    filter.with.filters = yaml.dump(parsed);
    const messages = flatpakCiPathFilterViolations(doc, 'ci.yaml').map(
      (violation) => violation.message,
    );
    expect(messages.join('\n')).toContain(requiredPath);
  });

  it('rejects a Flatpak policy scanner gated by its own path filter', () => {
    const doc = realCiWorkflow();
    const scanner = doc.jobs['policy-scanners'].steps.find(
      (step) => typeof step.run === 'string' && step.run.includes('pnpm run check:flatpak'),
    );
    scanner.if = "needs.changes.outputs.flatpak == 'true'";
    expect(flatpakCiPathFilterViolations(doc, 'ci.yaml')).toContainEqual({
      file: 'ci.yaml',
      message: 'policy-scanners must run check:flatpak unconditionally',
    });
  });

  it('rejects removal of the always-on Flatpak policy scanner', () => {
    const doc = realCiWorkflow();
    const scanner = doc.jobs['policy-scanners'].steps.find(
      (step) => typeof step.run === 'string' && step.run.includes('pnpm run check:flatpak'),
    );
    scanner.run = scanner.run
      .split('\n')
      .filter((line) => line.trim() !== 'pnpm run check:flatpak')
      .join('\n');
    expect(flatpakCiPathFilterViolations(doc, 'ci.yaml')).toContainEqual({
      file: 'ci.yaml',
      message: 'policy-scanners must run check:flatpak unconditionally',
    });
  });
});

describe('manifest Reticulum sidecar executable bit', () => {
  it('requires chmod 755 after resources copy in the real manifest', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'org.coloradomesh.MeshClient.yml'), 'utf8');
    expect(manifest).toContain(
      'chmod 755 /app/lib/mesh-client/resources/reticulum-sidecar/mesh-client-reticulum',
    );
  });
});

describe('Electron archive sources', () => {
  it('keep strip-components: 0 in the real manifest', () => {
    const manifest = fs.readFileSync(path.join(ROOT, 'org.coloradomesh.MeshClient.yml'), 'utf8');
    const blocks = manifest
      .split(/^\s*- type: archive\s*$/m)
      .filter((block) => /electron-v[\d.]+-linux-(?:x64|arm64)\.zip/.test(block));

    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      // strip-components:1 (the flatpak-builder default) flattens locales/ and
      // resources/ into dest, and Electron then exits 1 with no output.
      expect(block).toMatch(/strip-components:\s*0\b/);
    }
  });
});
