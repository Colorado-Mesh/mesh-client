import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { RfDiagnosticRow } from '@/renderer/lib/types';

import { ReticulumDiagnosticsSection } from './ReticulumDiagnosticsSection';

const repairReticulumConfig = vi.hoisted(() => vi.fn());

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

vi.mock('@/renderer/lib/reticulum/reticulumConfigAudit', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return {
    ...mod,
    repairReticulumConfig,
  };
});

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

  it('runs disable_share_instance repair from the action button', async () => {
    const user = userEvent.setup();
    repairReticulumConfig.mockReset();
    repairReticulumConfig.mockResolvedValue({ ok: true, repaired: ['disable_share_instance'] });
    const shareRow: RfDiagnosticRow = {
      kind: 'rf',
      id: 'rf:1:reticulum/audit/shared_instance_client',
      nodeId: 1,
      condition: 'reticulum/audit/shared_instance_client',
      cause: 'client',
      severity: 'warning',
      detectedAt: Date.now(),
      causeI18n: {
        key: 'diagnosticsPanel.reticulum.audit.shared_instance_client',
        params: { name: '', message: 'client' },
      },
      reticulumRepairKind: 'disable_share_instance',
    };
    render(<ReticulumDiagnosticsSection rows={[shareRow]} />);
    expect(
      screen.getByText('diagnosticsPanel.reticulum.action.disable_share_instance'),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', {
        name: 'diagnosticsPanel.reticulum.action.disable_share_instance',
      }),
    );
    await waitFor(() => {
      expect(repairReticulumConfig).toHaveBeenCalledWith(['disable_share_instance']);
    });
  });

  it('has no serious axe violations', async () => {
    const { container } = render(<ReticulumDiagnosticsSection rows={[reticulumRow]} />);
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
