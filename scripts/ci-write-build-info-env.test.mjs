import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildMeshClientBuildInfoPayload,
  formatGithubEnvAssignment,
  readReleaseTagFromPackageJson,
  shortSha,
  writeBuildInfoEnv,
} from './ci-write-build-info-env.mjs';

describe('shortSha', () => {
  it('truncates to 7 chars', () => {
    expect(shortSha('abcdef0123456789')).toBe('abcdef0');
  });
});

describe('buildMeshClientBuildInfoPayload', () => {
  it('builds test payload with runUrl', () => {
    expect(
      buildMeshClientBuildInfoPayload({
        channel: 'test',
        workflow: 'Build Binaries (no release)',
        runId: '123',
        runNumber: '1842',
        sha: 'abcdef0123456789',
        serverUrl: 'https://github.com',
        repository: 'Colorado-Mesh/mesh-client',
      }),
    ).toEqual({
      channel: 'test',
      workflow: 'Build Binaries (no release)',
      runId: '123',
      runNumber: 1842,
      sha: 'abcdef0',
      runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/123',
    });
  });

  it('includes tag for release', () => {
    expect(
      buildMeshClientBuildInfoPayload({
        channel: 'release',
        tag: 'v5.26.0',
        runId: '9',
        runNumber: 1,
        sha: 'deadbeef',
        repository: 'Colorado-Mesh/mesh-client',
      }),
    ).toMatchObject({
      channel: 'release',
      tag: 'v5.26.0',
      runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/9',
    });
  });

  it('rejects invalid channel', () => {
    expect(() =>
      buildMeshClientBuildInfoPayload({ channel: /** @type {any} */ ('nightly') }),
    ).toThrow(/test\|release/);
  });
});

describe('formatGithubEnvAssignment', () => {
  it('uses heredoc delimiters', () => {
    const text = formatGithubEnvAssignment({ channel: 'test', runId: '1' });
    expect(text).toContain('MESH_CLIENT_BUILD_INFO<<MESH_BUILD_INFO_EOF\n');
    expect(text).toContain('{"channel":"test","runId":"1"}');
    expect(text.endsWith('MESH_BUILD_INFO_EOF\n')).toBe(true);
  });
});

describe('writeBuildInfoEnv', () => {
  /** @type {string[]} */
  const tempDirs = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('appends heredoc assignment to GITHUB_ENV', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-build-info-'));
    tempDirs.push(dir);
    const envFile = path.join(dir, 'github.env');
    fs.writeFileSync(envFile, '', 'utf8');

    const { payload } = writeBuildInfoEnv({
      MESH_CLIENT_BUILD_CHANNEL: 'test',
      MESH_CLIENT_BUILD_WORKFLOW: 'Build Binaries (no release)',
      GITHUB_ENV: envFile,
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_NUMBER: '7',
      GITHUB_SHA: 'abcdef0123456789',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_REPOSITORY: 'Colorado-Mesh/mesh-client',
    });

    expect(payload.channel).toBe('test');
    const written = fs.readFileSync(envFile, 'utf8');
    expect(written).toContain('MESH_CLIENT_BUILD_INFO<<MESH_BUILD_INFO_EOF');
    expect(written).toContain('"runId":"42"');
  });

  it('defaults release tag from package.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesh-build-info-pkg-'));
    tempDirs.push(dir);
    const pkgPath = path.join(dir, 'package.json');
    fs.writeFileSync(pkgPath, JSON.stringify({ version: '1.2.3' }), 'utf8');
    const envFile = path.join(dir, 'github.env');
    fs.writeFileSync(envFile, '', 'utf8');

    const { payload } = writeBuildInfoEnv(
      {
        MESH_CLIENT_BUILD_CHANNEL: 'release',
        GITHUB_ENV: envFile,
        GITHUB_RUN_ID: '1',
        GITHUB_RUN_NUMBER: '1',
        GITHUB_SHA: 'abc',
        GITHUB_REPOSITORY: 'Colorado-Mesh/mesh-client',
      },
      { packageJsonPath: pkgPath },
    );

    expect(payload.tag).toBe('v1.2.3');
    expect(readReleaseTagFromPackageJson(pkgPath)).toBe('v1.2.3');
  });
});
