import { describe, expect, it } from 'vitest';

import {
  isMeshcomSensitiveCommandLine,
  redactMeshcomCommandArgForLog,
  redactMeshcomSecretsInText,
} from './meshcomCommandSecrets';

describe('meshcomCommandSecrets', () => {
  it('detects sensitive command tokens including --passwd', () => {
    expect(isMeshcomSensitiveCommandLine('--passwd secret')).toBe(true);
    expect(isMeshcomSensitiveCommandLine('--setpwd wifi')).toBe(true);
    expect(isMeshcomSensitiveCommandLine('--volt on')).toBe(false);
  });

  it('redacts command args for log lines', () => {
    expect(redactMeshcomCommandArgForLog('--passwd node-secret')).toBe('--passwd [redacted]');
    expect(redactMeshcomCommandArgForLog('--volt on')).toBe('--volt on');
  });

  it('scrubs sensitive args from free text for support bundles', () => {
    const text =
      '[useMeshcomDeviceCommands] sent --passwd node-secret\n' +
      'mcL0699 [useMeshcomDeviceCommands] --setpwd wifi-pass failed: ETIMEDOUT\n' +
      'keep --volt on\n';
    expect(redactMeshcomSecretsInText(text)).toBe(
      '[useMeshcomDeviceCommands] sent --passwd [redacted]\n' +
        'mcL0699 [useMeshcomDeviceCommands] --setpwd [redacted] failed: ETIMEDOUT\n' +
        'keep --volt on\n',
    );
  });
});
