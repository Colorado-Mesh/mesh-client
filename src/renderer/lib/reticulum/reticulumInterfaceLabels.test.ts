import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';

import {
  formatReticulumInterfaceRowSummary,
  reticulumIfaceTypeLabel,
} from './reticulumInterfaceLabels';

describe('reticulumInterfaceLabels', () => {
  const t = vi.fn((key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
  ) as unknown as TFunction;

  it('maps wire types to display acronyms', () => {
    expect(reticulumIfaceTypeLabel('tcp')).toBe('TCP');
    expect(reticulumIfaceTypeLabel('rnode')).toBe('RNode');
  });

  it('formats row summary with translated status', () => {
    formatReticulumInterfaceRowSummary(t, {
      name: 'Hub',
      type: 'tcp',
      status: 'down',
    });
    expect(t).toHaveBeenCalledWith(
      'connectionPanel.reticulumInterfaces.rowSummary',
      expect.objectContaining({
        name: 'Hub',
        type: 'TCP',
      }),
    );
  });

  it('formats row summary with mode when set', () => {
    formatReticulumInterfaceRowSummary(t, {
      name: 'Hub',
      type: 'tcp',
      status: 'up',
      mode: 'boundary',
    });
    expect(t).toHaveBeenCalledWith(
      'connectionPanel.reticulumInterfaces.rowSummaryWithMode',
      expect.objectContaining({
        name: 'Hub',
        type: 'TCP',
        mode: 'connectionPanel.reticulumInterfaces.modeOption.boundary',
      }),
    );
  });
});
