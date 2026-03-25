import { describe, expect, it } from 'vitest';

import {
  LINUX_BLE_DEV_LAUNCH_NPM_SCRIPT,
  LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET,
  linuxBleCapabilityWarningBanner,
  linuxBleHumanizeCapabilityMissingMessage,
  linuxBleNobleCapabilityErrorBody,
} from './linuxBleDevLaunch';

describe('linuxBleDevLaunch', () => {
  it('pins npm run linux and setpriv anchors for regression safety', () => {
    expect(LINUX_BLE_DEV_LAUNCH_NPM_SCRIPT).toBe('npm run linux');
    expect(LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET).toContain('sudo setpriv');
    expect(LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET).toContain('--ambient-caps +net_raw');
    expect(LINUX_BLE_DEV_LAUNCH_SETPRIV_SNIPPET).toContain('npm start -- -no-sandbox');
  });

  it('exposes user-facing strings that mention npm run linux', () => {
    expect(linuxBleHumanizeCapabilityMissingMessage()).toContain('npm run linux');
    expect(linuxBleCapabilityWarningBanner()).toContain('npm run linux');
    expect(linuxBleNobleCapabilityErrorBody()).toContain('npm run linux');
  });
});
