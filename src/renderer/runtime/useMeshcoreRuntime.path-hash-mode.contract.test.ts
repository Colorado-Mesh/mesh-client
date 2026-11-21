// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime path hash mode on connect', () => {
  it('clears stale runtime path caches when companion path hash mode changes', () => {
    expect(SOURCE).toMatch(
      /prev !== state\.pathHashMode[\s\S]*usePathHistoryStore\.getState\(\)\.clearAll\(\);[\s\S]*outPathMapRef\.current\.clear\(\);[\s\S]*radioContactPathLenByNodeRef\.current\.clear\(\);/,
    );
  });

  it('adopts device-reported mode into app settings and does not reapply saved mode to radio', () => {
    expect(SOURCE).toContain('initConn adopt pathHashMode from radio');
    expect(SOURCE).toMatch(
      /mergeAppSetting\(\s*'meshcorePathHashMode',\s*pathFields\.pathHashMode/,
    );
    expect(SOURCE).not.toMatch(/savedMode !== pathFields\.pathHashMode/);
    expect(SOURCE).not.toContain('initConn reapply path hash mode');
  });

  it('lets a companion that reported a path hash mode set multibyte modes whatever its version text', () => {
    expect(SOURCE).toMatch(
      /meshcoreCompanionSupportsMultibytePathHash\(\s*fw,\s*meshcoreDeviceReportedPathHashModeRef\.current,?\s*\)/,
    );
    expect(SOURCE).not.toMatch(/!meshcoreFirmwareSupportsMultibytePathHash\(fw\)/);
  });

  it('records the reported mode per connection: cleared when initConn starts, set from DeviceInfo', () => {
    expect(SOURCE).toMatch(
      /meshcoreInitConnInFlightRef\.current = true;\s*meshcoreDeviceReportedPathHashModeRef\.current = false;/,
    );
    expect(SOURCE).toMatch(
      /const pathFields = parsePathHashModeFromDeviceQuery\(deviceInfo\);\s*if \(isMeshcorePathHashMode\(pathFields\.pathHashMode\)\) \{\s*meshcoreDeviceReportedPathHashModeRef\.current = true;\s*\}/,
    );
    // The explicit query never clears a report the automatic DeviceInfo already made.
    expect(SOURCE).not.toMatch(
      /meshcoreDeviceReportedPathHashModeRef\.current = isMeshcorePathHashMode\(/,
    );
  });

  it('records the mode from the automatic DeviceInfo, only for the current connection', () => {
    expect(SOURCE).toMatch(
      /conn\.once\(MESHCORE_RESPONSE_DEVICE_INFO, \(response: unknown\) => \{\s*if \(\s*connRef\.current === conn &&\s*isMeshcorePathHashMode\(parsePathHashModeFromDeviceQuery\(response\)\.pathHashMode\)\s*\) \{\s*meshcoreDeviceReportedPathHashModeRef\.current = true;\s*\}/,
    );
  });
});
