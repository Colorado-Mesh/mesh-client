// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  buildInfoForManifest,
  formatBuildInfoLogFragment,
  getBuildInfo,
  parseBuildInfo,
} from './buildInfo';

describe('parseBuildInfo', () => {
  it('returns local for empty / whitespace', () => {
    expect(parseBuildInfo('')).toEqual({ buildChannel: 'local' });
    expect(parseBuildInfo('   ')).toEqual({ buildChannel: 'local' });
  });

  it('returns local for invalid JSON', () => {
    expect(parseBuildInfo('not-json')).toEqual({ buildChannel: 'local' });
    expect(parseBuildInfo('[]')).toEqual({ buildChannel: 'local' });
  });

  it('parses test channel with CI look-up fields', () => {
    const info = parseBuildInfo(
      JSON.stringify({
        channel: 'test',
        workflow: 'Build Binaries (no release)',
        runNumber: 1842,
        runId: '12345678901',
        runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/12345678901',
        sha: 'a1b2c3d',
      }),
    );
    expect(info).toEqual({
      buildChannel: 'test',
      workflow: 'Build Binaries (no release)',
      runNumber: 1842,
      runId: '12345678901',
      runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/12345678901',
      sha: 'a1b2c3d',
    });
  });

  it('accepts buildChannel key and string runNumber', () => {
    const info = parseBuildInfo(
      JSON.stringify({
        buildChannel: 'release',
        runNumber: '99',
        tag: 'v5.26.0',
      }),
    );
    expect(info.buildChannel).toBe('release');
    expect(info.runNumber).toBe(99);
    expect(info.tag).toBe('v5.26.0');
  });

  it('falls back to local for unknown channel', () => {
    expect(parseBuildInfo(JSON.stringify({ channel: 'nightly' }))).toEqual({
      buildChannel: 'local',
    });
  });
});

describe('formatBuildInfoLogFragment', () => {
  it('includes channel only for local', () => {
    expect(formatBuildInfoLogFragment({ buildChannel: 'local' })).toBe('buildChannel=local');
  });

  it('includes compact CI fields without runUrl', () => {
    const fragment = formatBuildInfoLogFragment({
      buildChannel: 'test',
      runNumber: 1842,
      runId: '12345678901',
      runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/12345678901',
      sha: 'a1b2c3d',
    });
    expect(fragment).toBe('buildChannel=test run=1842 runId=12345678901 sha=a1b2c3d');
    expect(fragment).not.toContain('runUrl');
  });

  it('includes tag for release builds', () => {
    expect(
      formatBuildInfoLogFragment({
        buildChannel: 'release',
        tag: 'v5.26.0',
        runNumber: 10,
        runId: '99',
        sha: 'deadbee',
      }),
    ).toBe('buildChannel=release tag=v5.26.0 run=10 runId=99 sha=deadbee');
  });
});

describe('buildInfoForManifest', () => {
  it('omits buildInfo when only channel is set', () => {
    expect(buildInfoForManifest({ buildChannel: 'local' })).toEqual({
      buildChannel: 'local',
    });
  });

  it('includes buildInfo with look-up fields', () => {
    expect(
      buildInfoForManifest({
        buildChannel: 'test',
        workflow: 'Build Binaries (no release)',
        runNumber: 1842,
        runId: '12345678901',
        runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/12345678901',
        sha: 'a1b2c3d',
      }),
    ).toEqual({
      buildChannel: 'test',
      buildInfo: {
        workflow: 'Build Binaries (no release)',
        runNumber: 1842,
        runId: '12345678901',
        runUrl: 'https://github.com/Colorado-Mesh/mesh-client/actions/runs/12345678901',
        sha: 'a1b2c3d',
      },
    });
  });
});

describe('getBuildInfo', () => {
  it('returns local when compile-time stamp is unset (unit tests)', () => {
    expect(getBuildInfo()).toEqual({ buildChannel: 'local' });
  });
});
