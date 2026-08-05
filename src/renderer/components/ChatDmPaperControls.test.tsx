import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import {
  ChatDmPaperShareControl,
  ChatPaperScanControl,
} from '@/renderer/components/ChatDmPaperControls';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { mockConsoleWarn } from '@/renderer/lib/vitestConsoleMock';

const addToast = vi.fn();
const createReticulumPaperMessage = vi.fn();
const handleReticulumQrIngest = vi.fn();
const writeClipboardText = vi.fn().mockResolvedValue(undefined);
const loadDraftsInitial = vi.fn().mockReturnValue({ 'dm:peer': 'draft text' });

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/components/Toast', () => ({
  useToast: () => ({ addToast }),
}));

vi.mock('@/renderer/hooks/useActiveMeshIdentity', () => ({
  useActiveMeshIdentity: () => ({ focusedIdentityId: 'id-reticulum' }),
}));

vi.mock('@/renderer/lib/chatPanelProtocolStorage', () => ({
  loadDraftsInitial: (...args: unknown[]) => loadDraftsInitial(...args),
}));

vi.mock('@/renderer/lib/reticulum/createReticulumPaperMessage', () => ({
  createReticulumPaperMessage: (...args: unknown[]) => createReticulumPaperMessage(...args),
}));

vi.mock('@/renderer/lib/reticulum/handleReticulumQrIngest', () => ({
  handleReticulumQrIngest: (...args: unknown[]) => handleReticulumQrIngest(...args),
}));

vi.mock('@/renderer/lib/writeClipboardText', () => ({
  writeClipboardText: (...args: unknown[]) => writeClipboardText(...args),
}));

vi.mock('@/renderer/components/QrCodeImage', () => ({
  default: ({ value }: { value: string }) => <div data-testid="qr">{value}</div>,
}));

vi.mock('@/renderer/components/QrIngestControl', () => ({
  default: ({ onDecoded, disabled }: { onDecoded: (text: string) => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label="mock-qr-ingest"
      onClick={() => {
        onDecoded(`lxm://${'A'.repeat(48)}`);
      }}
    >
      ingest
    </button>
  ),
}));

async function renderAndAssertAxe(ui: ReactElement): Promise<ReturnType<typeof render>> {
  const view = render(ui);
  hydrateAxeThemeColors(view.container);
  expect(await axe(view.container)).toHaveNoViolations();
  return view;
}

describe('ChatDmPaperControls', () => {
  beforeEach(() => {
    addToast.mockReset();
    createReticulumPaperMessage.mockReset();
    handleReticulumQrIngest.mockReset();
    writeClipboardText.mockReset();
    writeClipboardText.mockResolvedValue(undefined);
    loadDraftsInitial.mockReturnValue({ 'dm:peer': 'draft text' });
  });

  it('opens share modal with draft and creates paper QR', async () => {
    const user = userEvent.setup();
    createReticulumPaperMessage.mockResolvedValue({
      ok: true,
      uri: `lxm://${'B'.repeat(48)}`,
      messageHash: 'hh'.repeat(16),
    });

    await renderAndAssertAxe(
      <ChatDmPaperShareControl lxmfPeerHash={'aa'.repeat(16)} viewKey="dm:peer" sidecarRunning />,
    );

    await user.click(screen.getByLabelText('chatPanel.shareAsPaperAria'));
    expect(screen.getByLabelText('chatPanel.shareAsPaperTitle')).toBeTruthy();
    expect(screen.getByDisplayValue('draft text')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'chatPanel.shareAsPaperGenerate' }));
    await waitFor(() => {
      expect(createReticulumPaperMessage).toHaveBeenCalledWith({
        identityId: 'id-reticulum',
        destinationHash: 'aa'.repeat(16),
        text: 'draft text',
      });
    });
    expect(await screen.findByTestId('qr')).toHaveTextContent(`lxm://${'B'.repeat(48)}`);
  });

  it('toasts clipboard copy success and failure', async () => {
    const user = userEvent.setup();
    createReticulumPaperMessage.mockResolvedValue({
      ok: true,
      uri: `lxm://${'C'.repeat(48)}`,
      messageHash: 'ii'.repeat(16),
    });

    render(
      <ChatDmPaperShareControl lxmfPeerHash={'aa'.repeat(16)} viewKey="dm:peer" sidecarRunning />,
    );
    await user.click(screen.getByLabelText('chatPanel.shareAsPaperAria'));
    await user.click(screen.getByRole('button', { name: 'chatPanel.shareAsPaperGenerate' }));
    await screen.findByTestId('qr');

    await user.click(screen.getByRole('button', { name: 'chatPanel.shareAsPaperCopyUri' }));
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('chatPanel.shareAsPaperCopied', 'success');
    });

    const { spy, restore } = mockConsoleWarn();
    try {
      writeClipboardText.mockRejectedValueOnce(new Error('denied'));
      await user.click(screen.getByRole('button', { name: 'chatPanel.shareAsPaperCopyUri' }));
      await waitFor(() => {
        expect(addToast).toHaveBeenCalledWith('chatPanel.shareAsPaperCopyFailed', 'error');
      });
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('[ChatDmPaperShareControl] clipboard failed:'),
      );
    } finally {
      restore();
    }
  });

  it('disables share when sidecar is stopped', async () => {
    await renderAndAssertAxe(
      <ChatDmPaperShareControl
        lxmfPeerHash={'aa'.repeat(16)}
        viewKey="dm:peer"
        sidecarRunning={false}
      />,
    );
    expect(screen.getByLabelText('chatPanel.shareAsPaperAria')).toBeDisabled();
  });

  it('scan control ingests decoded QR and toasts', async () => {
    const user = userEvent.setup();
    handleReticulumQrIngest.mockResolvedValue({
      handled: true,
      toast: { key: 'qrIngest.paperIngested', variant: 'success' },
    });

    await renderAndAssertAxe(<ChatPaperScanControl sidecarRunning />);
    await user.click(screen.getByLabelText('chatPanel.scanPaperAria'));
    await user.click(screen.getByLabelText('mock-qr-ingest'));
    await waitFor(() => {
      expect(handleReticulumQrIngest).toHaveBeenCalled();
      expect(addToast).toHaveBeenCalledWith('qrIngest.paperIngested', 'success');
    });
  });
});
