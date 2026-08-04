// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const SOURCE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('useMeshcoreRuntime path hash mode on connect', () => {
  it('adopts device-reported mode into app settings and does not reapply saved mode to radio', () => {
    expect(SOURCE).toContain('initConn adopt pathHashMode from radio');
    expect(SOURCE).toMatch(
      /mergeAppSetting\(\s*'meshcorePathHashMode',\s*pathFields\.pathHashMode/,
    );
    expect(SOURCE).not.toMatch(/savedMode !== pathFields\.pathHashMode/);
    expect(SOURCE).not.toContain('initConn reapply path hash mode');
  });
});
