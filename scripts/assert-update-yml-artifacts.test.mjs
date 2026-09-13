import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertUpdateYmlArtifacts,
  assertUpdateYmlUrlsMatchBasenames,
  findDiskMatchForYmlUrl,
  parseElectronUpdateYml,
  stripInstallerRunStamp,
} from './assert-update-yml-artifacts.mjs';

/** @type {string[]} */
const tempDirs = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-update-yml-'));
  tempDirs.push(dir);
  return dir;
}

const WIN_YML = `version: 5.36.0
files:
  - url: Mesh-client-Setup-5.36.0.exe
    sha512: abc
  - url: Mesh-client-Setup-5.36.0-arm64.exe
    sha512: def
path: Mesh-client-Setup-5.36.0.exe
`;

const MAC_YML = `version: 5.36.0
files:
  - url: Mesh-client-5.36.0-mac.zip
    sha512: abc
path: Mesh-client-5.36.0-mac.zip
`;

const LINUX_YML = `version: 5.36.0
files:
  - url: Mesh-client-5.36.0.AppImage
    sha512: abc
path: Mesh-client-5.36.0.AppImage
`;

const LINUX_ARM_YML = `version: 5.36.0
files:
  - url: Mesh-client-5.36.0-arm64.AppImage
    sha512: abc
path: Mesh-client-5.36.0-arm64.AppImage
`;

describe('parseElectronUpdateYml', () => {
  it('reads files[].url and path', () => {
    expect(parseElectronUpdateYml(WIN_YML)).toEqual({
      urls: ['Mesh-client-Setup-5.36.0.exe', 'Mesh-client-Setup-5.36.0-arm64.exe'],
      path: 'Mesh-client-Setup-5.36.0.exe',
    });
  });
});

describe('stripInstallerRunStamp', () => {
  it('removes -run{N} before matching latest.yml urls', () => {
    expect(stripInstallerRunStamp('Mesh-client-Setup-5.36.0-run214.exe')).toBe(
      'Mesh-client-Setup-5.36.0.exe',
    );
    expect(stripInstallerRunStamp('Mesh-client-Setup-5.36.0-run214-arm64.exe')).toBe(
      'Mesh-client-Setup-5.36.0-arm64.exe',
    );
  });
});

describe('findDiskMatchForYmlUrl', () => {
  it('matches exact and stamped names', () => {
    expect(
      findDiskMatchForYmlUrl('Mesh-client-Setup-5.36.0.exe', ['Mesh-client-Setup-5.36.0-run9.exe']),
    ).toBe('Mesh-client-Setup-5.36.0-run9.exe');
  });
});

describe('assertUpdateYmlUrlsMatchBasenames', () => {
  it('accepts hyphenated Windows + mac + linux channel files', () => {
    const result = assertUpdateYmlUrlsMatchBasenames({
      ymlByName: {
        'latest.yml': WIN_YML,
        'latest-mac.yml': MAC_YML,
        'latest-linux.yml': LINUX_YML,
        'latest-linux-arm64.yml': LINUX_ARM_YML,
      },
      basenames: [
        'Mesh-client-Setup-5.36.0.exe',
        'Mesh-client-Setup-5.36.0-arm64.exe',
        'Mesh-client-5.36.0-mac.zip',
        'Mesh-client-5.36.0.AppImage',
        'Mesh-client-5.36.0-arm64.AppImage',
      ],
    });
    expect(result.checked).toHaveLength(4);
    expect(result.matched).toHaveLength(5);
  });

  it('rejects the v5.36.0 Windows mismatch (yml hyphenated, disk spaced or dotted)', () => {
    expect(() =>
      assertUpdateYmlUrlsMatchBasenames({
        ymlByName: { 'latest.yml': WIN_YML },
        basenames: ['Mesh-client Setup 5.36.0.exe', 'Mesh-client Setup 5.36.0-arm64.exe'],
      }),
    ).toThrow(/is not present/);
    expect(() =>
      assertUpdateYmlUrlsMatchBasenames({
        ymlByName: { 'latest.yml': WIN_YML },
        basenames: ['Mesh-client.Setup.5.36.0.exe', 'Mesh-client.Setup.5.36.0-arm64.exe'],
      }),
    ).toThrow(/is not present/);
  });

  it('skips .blockmap urls that packaging-smoke artifacts omit', () => {
    expect(() =>
      assertUpdateYmlUrlsMatchBasenames({
        ymlByName: {
          'latest-mac.yml': `files:
  - url: Mesh-client-5.36.0-mac.zip
  - url: Mesh-client-5.36.0-mac.zip.blockmap
path: Mesh-client-5.36.0-mac.zip
`,
        },
        basenames: ['Mesh-client-5.36.0-mac.zip'],
      }),
    ).not.toThrow();
  });

  it('rejects spaces inside yml urls', () => {
    expect(() =>
      assertUpdateYmlUrlsMatchBasenames({
        ymlByName: {
          'latest.yml':
            'path: Mesh-client Setup 5.36.0.exe\nfiles:\n  - url: Mesh-client Setup 5.36.0.exe\n',
        },
        basenames: ['Mesh-client Setup 5.36.0.exe'],
      }),
    ).toThrow(/contains spaces/);
  });

  it('requires named channel files when asked', () => {
    expect(() =>
      assertUpdateYmlUrlsMatchBasenames({
        ymlByName: { 'latest-mac.yml': MAC_YML },
        basenames: ['Mesh-client-5.36.0-mac.zip'],
        requiredFiles: ['latest.yml'],
      }),
    ).toThrow(/Missing required update channel file: latest.yml/);
  });
});

describe('assertUpdateYmlArtifacts', () => {
  it('walks nested mac artifacts and matches latest-mac.yml', () => {
    const root = makeTempDir();
    const mac = path.join(root, 'mac-arm64');
    fs.mkdirSync(mac, { recursive: true });
    fs.writeFileSync(path.join(root, 'latest-mac.yml'), MAC_YML);
    fs.writeFileSync(path.join(mac, 'Mesh-client-5.36.0-mac.zip'), 'x');
    const result = assertUpdateYmlArtifacts({
      rootDir: root,
      requiredFiles: ['latest-mac.yml'],
    });
    expect(result.matched).toEqual([
      {
        yml: 'latest-mac.yml',
        url: 'Mesh-client-5.36.0-mac.zip',
        disk: 'Mesh-client-5.36.0-mac.zip',
      },
    ]);
  });
});
