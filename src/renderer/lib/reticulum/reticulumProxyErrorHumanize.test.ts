import { describe, expect, it } from 'vitest';

import {
  formatReticulumProxyErrorMessage,
  reticulumProxyErrorToI18nKey,
} from './reticulumProxyErrorHumanize';

describe('reticulumProxyErrorHumanize', () => {
  it('maps IPC send timeout to shared chat timeout key', () => {
    expect(reticulumProxyErrorToI18nKey('RETICULUM_IPC_SEND_TIMEOUT')).toBe(
      'chatPanel.reticulumSendTimeout',
    );
  });

  it('splits sidecar stopped vs still attaching', () => {
    expect(reticulumProxyErrorToI18nKey('sidecar_not_running')).toBe('rrc.sidecarNotRunning');
    expect(reticulumProxyErrorToI18nKey('stack_not_ready')).toBe('rrc.stackNotReady');
    expect(reticulumProxyErrorToI18nKey('rrc connect requires live rns-stack sidecar')).toBe(
      'rrc.stackNotReady',
    );
    expect(reticulumProxyErrorToI18nKey('lxmf send requires live rns-stack sidecar')).toBe(
      'rrc.stackNotReady',
    );
  });

  it('formats known keys via t()', () => {
    expect(formatReticulumProxyErrorMessage('sidecar_not_running', (k) => `T:${k}`)).toBe(
      'T:rrc.sidecarNotRunning',
    );
  });
});
