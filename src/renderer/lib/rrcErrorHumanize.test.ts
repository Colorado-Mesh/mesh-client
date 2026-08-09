import { describe, expect, it } from 'vitest';

import { formatRrcErrorMessage, rrcErrorToI18nKey } from './rrcErrorHumanize';

describe('rrcErrorHumanize', () => {
  it('maps link proof timeouts', () => {
    expect(rrcErrorToI18nKey('timed out waiting for link proof')).toBe(
      'rrc.errors.linkProofTimeout',
    );
    expect(formatRrcErrorMessage('timed out waiting for link proof', (k) => `T:${k}`)).toBe(
      'T:rrc.errors.linkProofTimeout',
    );
  });

  it('maps proxy rate-limit errors to the shared i18n key', () => {
    expect(rrcErrorToI18nKey('rate limit exceeded')).toBe('rrc.errors.proxyRateLimit');
    expect(formatRrcErrorMessage('rate limit exceeded', (k) => `T:${k}`)).toBe(
      'T:rrc.errors.proxyRateLimit',
    );
  });

  it('passes through unknown errors', () => {
    expect(rrcErrorToI18nKey('unexpected boom')).toBeNull();
    expect(formatRrcErrorMessage('unexpected boom', (k) => k)).toBe('unexpected boom');
  });

  it('maps IPC send timeout and stack readiness tags', () => {
    expect(rrcErrorToI18nKey('RETICULUM_IPC_SEND_TIMEOUT')).toBe('chatPanel.reticulumSendTimeout');
    expect(rrcErrorToI18nKey('sidecar_not_running')).toBe('rrc.sidecarNotRunning');
    expect(rrcErrorToI18nKey('stack_not_ready')).toBe('rrc.stackNotReady');
    expect(rrcErrorToI18nKey('rrc connect requires live rns-stack sidecar')).toBe(
      'rrc.stackNotReady',
    );
  });
});
