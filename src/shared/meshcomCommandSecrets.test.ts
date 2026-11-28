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

  it('does not treat a following secret command as the argument', () => {
    const spaced = redactMeshcomSecretsInText('--passwd --setpwd meshcom-secret');
    const lined = redactMeshcomSecretsInText('--passwd\n--setpwd meshcom-secret');
    expect(spaced).not.toContain('meshcom-secret');
    expect(lined).not.toContain('meshcom-secret');
    expect(spaced).toContain('--setpwd [redacted]');
    expect(lined).toContain('--setpwd [redacted]');
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
