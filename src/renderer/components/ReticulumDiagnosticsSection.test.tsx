import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { RfDiagnosticRow } from '@/renderer/lib/types';

import { ReticulumDiagnosticsSection } from './ReticulumDiagnosticsSection';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params && Object.keys(params).length > 0 ? `${key}:${JSON.stringify(params)}` : key,
  }),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast: vi.fn() }),
}));

vi.mock('@/renderer/lib/sessions/reticulumSession', () => ({
  tryGetReticulumSession: () => ({ restartStack: vi.fn() }),
}));

const reticulumRow: RfDiagnosticRow = {
  kind: 'rf',
  id: 'rf:1:reticulum/audit/ghost_interface/tcp-1',
  nodeId: 1,
  condition: 'reticulum/audit/ghost_interface',
  cause: 'ghost',
  severity: 'error',
  detectedAt: Date.now(),
  causeI18n: {
    key: 'diagnosticsPanel.reticulum.audit.ghost_interface',
    params: { name: 'Dublin', message: 'ghost' },
  },
  reticulumInterfaceId: 'tcp-1',
  reticulumRepairKind: 'repair_config',
};

describe('ReticulumDiagnosticsSection', () => {
  it('renders runtime row via translateReticulumDiagnosticCause', () => {
    const runtimeRow: RfDiagnosticRow = {
      kind: 'rf',
      id: 'rf:1:reticulum/rns-not-ready',
      nodeId: 1,
      condition: 'reticulum/rns-not-ready',
      cause: 'RNS stack is not ready',
      severity: 'warning',
      detectedAt: Date.now(),
      causeI18n: { key: 'diagnosticsPanel.reticulum.runtime.rnsNotReady' },
    };
    render(<ReticulumDiagnosticsSection rows={[runtimeRow]} />);
    expect(screen.getByText('diagnosticsPanel.reticulum.runtime.rnsNotReady')).toBeInTheDocument();
  });

  it('renders audit rows with repair action', () => {
    render(<ReticulumDiagnosticsSection rows={[reticulumRow]} />);
    expect(screen.getByText('diagnosticsPanel.reticulum.action.repair_config')).toBeInTheDocument();
    expect(
      screen.getByText(
        'diagnosticsPanel.reticulum.audit.ghost_interface:{"name":"Dublin","message":"ghost"}',
      ),
    ).toBeInTheDocument();
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<ReticulumDiagnosticsSection rows={[reticulumRow]} />);
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
