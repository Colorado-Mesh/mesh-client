// @vitest-environment node
import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
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
