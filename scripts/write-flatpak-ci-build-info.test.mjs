import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FLATPAK_BUILD_INFO_EXPORT_SNIPPET,
  parseBuildInfoJsonObject,
  writeFlatpakCiBuildInfoFile,
} from './write-flatpak-ci-build-info.mjs';

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('FLATPAK_BUILD_INFO_EXPORT_SNIPPET', () => {
  it('exports from flatpak/ci-build-info.json then builds', () => {
    expect(FLATPAK_BUILD_INFO_EXPORT_SNIPPET).toContain('flatpak/ci-build-info.json');
    expect(FLATPAK_BUILD_INFO_EXPORT_SNIPPET).toContain('MESH_CLIENT_BUILD_INFO');
    expect(FLATPAK_BUILD_INFO_EXPORT_SNIPPET).toContain('pnpm run build');
  });
});

describe('writeFlatpakCiBuildInfoFile', () => {
  it('writes JSON from MESH_CLIENT_BUILD_INFO env', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flatpak-ci-build-info-'));
    tempDirs.push(dir);
    const outPath = path.join(dir, 'ci-build-info.json');
    const payload = {
      channel: 'test',
      runNumber: 214,
      runId: '1',
      sha: 'bd42368',
    };
    const result = writeFlatpakCiBuildInfoFile(
      { MESH_CLIENT_BUILD_INFO: JSON.stringify(payload) },
      { outPath },
    );
    expect(result.payload).toEqual(payload);
    expect(JSON.parse(fs.readFileSync(outPath, 'utf8'))).toEqual(payload);
  });

  it('builds payload from Actions env when MESH_CLIENT_BUILD_INFO is absent', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flatpak-ci-build-info-'));
    tempDirs.push(dir);
    const outPath = path.join(dir, 'ci-build-info.json');
    const result = writeFlatpakCiBuildInfoFile(
      {
        MESH_CLIENT_BUILD_CHANNEL: 'test',
        MESH_CLIENT_BUILD_WORKFLOW: 'Build Flatpak (no release)',
        GITHUB_RUN_ID: '99',
        GITHUB_RUN_NUMBER: '214',
        GITHUB_SHA: 'bd423682bafb610fd16b9131e52605aaf80f1728',
        GITHUB_REPOSITORY: 'Colorado-Mesh/mesh-client',
        GITHUB_SERVER_URL: 'https://github.com',
      },
      { outPath },
    );
    expect(result.payload).toMatchObject({
      channel: 'test',
      runNumber: 214,
      sha: 'bd42368',
      runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/99',
    });
  });

  it('parseBuildInfoJsonObject rejects non-objects', () => {
    expect(() => parseBuildInfoJsonObject('[]')).toThrow(/JSON object/);
  });
});
