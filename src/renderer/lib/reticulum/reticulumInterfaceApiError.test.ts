import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';

import { humanizeReticulumInterfaceApiError } from './reticulumInterfaceApiError';

function mockT(): TFunction {
  return ((key: string) => key) as TFunction;
}

describe('humanizeReticulumInterfaceApiError', () => {
  const t = mockT();

  it('maps identity not configured to i18n key', () => {
    expect(
      humanizeReticulumInterfaceApiError(
        'identity not configured',
        t,
        'connectionPanel.reticulumInterfaces.addFailed',
      ),
    ).toBe('connectionPanel.reticulumInterfaces.identityNotConfigured');
  });

  it('maps live-stack identity variant to i18n key', () => {
    expect(
      humanizeReticulumInterfaceApiError(
        'identity not configured for live stack',
        t,
        'connectionPanel.reticulumInterfaces.addFailed',
      ),
    ).toBe('connectionPanel.reticulumInterfaces.identityNotConfigured');
  });

  it('returns trimmed error when not a known identity failure', () => {
    expect(
      humanizeReticulumInterfaceApiError(
        '  interface not found: foo  ',
        t,
        'connectionPanel.reticulumInterfaces.addFailed',
      ),
    ).toBe('interface not found: foo');
  });

  it('falls back when error is empty', () => {
    expect(
      humanizeReticulumInterfaceApiError(
        '',
        t,
        'connectionPanel.reticulumInterfaces.addDefaultHubsFailed',
      ),
    ).toBe('connectionPanel.reticulumInterfaces.addDefaultHubsFailed');
  });
});
