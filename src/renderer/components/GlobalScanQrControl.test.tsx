import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import GlobalScanQrControl from '@/renderer/components/GlobalScanQrControl';
import { buildMeshcoreContactAddUri } from '@/shared/meshClientDeepLink';

const addToast = vi.fn();
const importMeshcoreContactFromQr = vi.fn();
const handleReticulumQrIngest = vi.fn();
const requestOpenSetting = vi.fn();

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('@/renderer/lib/reticulum/handleReticulumQrIngest', () => ({
  handleReticulumQrIngest: (...args: unknown[]) => handleReticulumQrIngest(...args),
}));

vi.mock('@/renderer/lib/reticulum/showReticulumQrIngestToast', () => ({
  showReticulumQrIngestToast: () => true,
}));

vi.mock('@/renderer/lib/openSettingRequest', () => ({
  requestOpenSetting: (...args: unknown[]) => requestOpenSetting(...args),
}));

vi.mock('@/renderer/components/QrIngestControl', () => ({
  default: ({ onDecoded }: { onDecoded: (text: string) => void }) => (
    <button
      type="button"
      aria-label="mock-qr-ingest"
      onClick={() => {
        onDecoded(
          buildMeshcoreContactAddUri({
            name: 'Global',
            publicKeyHex: 'e'.repeat(64),
            type: 1,
          }),
        );
      }}
    >
      ingest
    </button>
  ),
}));

describe('GlobalScanQrControl', () => {
  beforeEach(() => {
    addToast.mockReset();
    importMeshcoreContactFromQr.mockReset();
    handleReticulumQrIngest.mockReset();
    requestOpenSetting.mockReset();
  });

  it('routes a MeshCore contact QR through importMeshcoreContactFromQr', async () => {
    const user = userEvent.setup();
    importMeshcoreContactFromQr.mockResolvedValue({
      ok: true,
      kind: 'contact',
      toastKey: 'qrIngest.meshcoreContactImported',
    });
    const onHandled = vi.fn();
    render(
      <GlobalScanQrControl
        importMeshcoreContactFromQr={importMeshcoreContactFromQr}
        onHandled={onHandled}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'qrIngest.scanQrAria' }));
    await user.click(screen.getByLabelText('mock-qr-ingest'));
    await waitFor(() => {
      expect(importMeshcoreContactFromQr).toHaveBeenCalled();
    });
    expect(addToast).toHaveBeenCalledWith('qrIngest.meshcoreContactImported', 'success');
    expect(onHandled).toHaveBeenCalled();
  });
});
