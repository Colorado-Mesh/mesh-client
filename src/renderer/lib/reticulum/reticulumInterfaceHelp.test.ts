import { describe, expect, it } from 'vitest';

import {
  getReticulumInterfaceHelp,
  RETICULUM_SHARED_INSTANCE_CLIENT_NAME,
  RETICULUM_SHARED_INSTANCE_NAME,
} from './reticulumInterfaceHelp';

describe('reticulumInterfaceHelp', () => {
  it('marks SharedInstanceServer as runtime-only and system-managed', () => {
    const help = getReticulumInterfaceHelp({
      id: 'shared',
      name: RETICULUM_SHARED_INSTANCE_NAME,
      type: 'tcp',
    });
    expect(help.isRuntimeOnly).toBe(true);
    expect(help.isSystemManaged).toBe(true);
    expect(help.purposeKey).toBe('connectionPanel.reticulumInterfaces.purpose.sharedInstance');
  });

  it('marks SharedInstanceClient with client-specific purpose copy', () => {
    const help = getReticulumInterfaceHelp({
      id: 'shared-client',
      name: RETICULUM_SHARED_INSTANCE_CLIENT_NAME,
      type: 'tcp',
    });
    expect(help.isRuntimeOnly).toBe(true);
    expect(help.isSystemManaged).toBe(true);
    expect(help.purposeKey).toBe(
      'connectionPanel.reticulumInterfaces.purpose.sharedInstanceClient',
    );
  });

  it('classifies auto interface purpose', () => {
    const help = getReticulumInterfaceHelp({
      id: 'auto-1',
      name: 'Default Interface',
      type: 'auto',
    });
    expect(help.purposeKey).toBe('connectionPanel.reticulumInterfaces.purpose.auto');
    expect(help.isRuntimeOnly).toBe(false);
  });

  it('classifies BLE RNode transport', () => {
    const help = getReticulumInterfaceHelp({
      id: 'ble-rnode',
      name: 'RNode BLE',
      type: 'rnode',
      serial_port: 'ble://AA:BB:CC:DD:EE:FF',
    });
    expect(help.purposeKey).toBe('connectionPanel.reticulumInterfaces.purpose.rnodeBle');
  });
});
