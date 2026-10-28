import { describe, expect, it } from 'vitest';

import { loadRuntimeSource } from '../lib/sourceContractTestHelpers';

const MESHTASTIC = loadRuntimeSource('useMeshtasticRuntime.ts');
const MESHCORE = loadRuntimeSource('useMeshcoreRuntime.ts');

describe('device status IPC unmount cleanup (source contract)', () => {
  it('Meshtastic notifies main on runtime unmount so power-save flags clear', () => {
    expect(MESHTASTIC).toMatch(
      /useEffect\(\(\) => \{\s*return \(\) => \{\s*window\.electronAPI\.notifyDeviceDisconnected\(\);/,
    );
  });

  it('MeshCore notifies main on runtime unmount so power-save flags clear', () => {
    expect(MESHCORE).toMatch(
      /useEffect\(\(\) => \{\s*return \(\) => \{\s*window\.electronAPI\.notifyDeviceDisconnected\('meshcore'\);/,
    );
  });
});
