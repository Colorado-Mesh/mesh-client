import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import type { RfDiagnosticRow } from '@/renderer/lib/types';

import { translateReticulumDiagnosticCause } from './reticulumDiagnosticLabels';

describe('translateReticulumDiagnosticCause', () => {
  const t = vi.fn((key: string, params?: Record<string, unknown>) => {
    if (key.startsWith('connectionPanel.reticulumInterfaces.status.')) {
      return key;
    }
    return params ? `${key}:${JSON.stringify(params)}` : key;
  }) as unknown as TFunction;

  it('localizes interface type wire value to acronym', () => {
    const row: RfDiagnosticRow = {
      kind: 'rf',
      id: 'rf:1:reticulum/interface-down/x',
      nodeId: 1,
      condition: 'reticulum/interface-down',
      cause: 'tcp interface "Hub" is enabled but down',
      severity: 'warning',
      detectedAt: 1,
      causeI18n: {
        key: 'diagnosticsPanel.reticulum.runtime.interfaceDown',
        params: { type: 'tcp', name: 'Hub', status: 'down' },
      },
    };
    const result = translateReticulumDiagnosticCause(t, row);
    expect(result).toContain('diagnosticsPanel.reticulum.runtime.interfaceDown');
    expect(t).toHaveBeenCalledWith(
      'diagnosticsPanel.reticulum.runtime.interfaceDown',
      expect.objectContaining({
        type: 'TCP',
        name: 'Hub',
        status: 'connectionPanel.reticulumInterfaces.status.down',
      }),
    );
  });
});
