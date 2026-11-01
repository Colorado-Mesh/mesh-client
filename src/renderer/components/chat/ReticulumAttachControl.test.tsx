import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useReticulumAttachmentSendStore } from '@/renderer/stores/reticulumAttachmentSendStore';

const addToast = vi.fn();
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../Toast', () => ({ useToast: () => ({ addToast }) }));

const sendMock = vi.hoisted(() => vi.fn());
const cancelMock = vi.hoisted(() => vi.fn());
vi.mock('@/renderer/lib/reticulum/sendReticulumAttachments', () => ({
  sendReticulumAttachments: sendMock,
  cancelReticulumAttachmentTransfer: cancelMock,
}));

import { ReticulumAttachControl } from './ReticulumAttachControl';

const IDENTITY = 'id-1';
const DEST = 0x1234;

beforeEach(() => {
  addToast.mockReset();
  sendMock.mockReset().mockResolvedValue(true);
  cancelMock.mockReset().mockResolvedValue(undefined);
  useReticulumAttachmentSendStore.getState().reset();
});

function renderControl(disabled = false) {
  const view = render(
    <ReticulumAttachControl identityId={IDENTITY} destination={DEST} disabled={disabled} />,
  );
  hydrateAxeThemeColors(view.container);
  return view;
}

describe('ReticulumAttachControl', () => {
  it('opens a menu with file and photo actions and passes axe', async () => {
    const view = renderControl();
    expect(await axe(view.container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'chatPanel.attachment.attachAria' }));
    expect(screen.getByRole('menuitem', { name: /chatPanel.attachment.attachFile/ })).toBeDefined();
    expect(
      screen.getByRole('menuitem', { name: /chatPanel.attachment.attachPhoto/ }),
    ).toBeDefined();
    expect(await axe(view.container)).toHaveNoViolations();
  });

  it('sends picked files as native attachments to the active DM', async () => {
    renderControl();
    const input = screen.getByTestId('reticulum-attach-file-input');
    const file = new File(['hello'], 'a.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(sendMock).toHaveBeenCalledTimes(1);
    });
    const arg = sendMock.mock.calls[0][0] as {
      identityId: string;
      destination: number;
      prepared: { kind: string; files: { fileName: string }[] };
    };
    expect(arg.identityId).toBe(IDENTITY);
    expect(arg.destination).toBe(DEST);
    expect(arg.prepared.kind).toBe('files');
    expect(arg.prepared.files[0].fileName).toBe('a.txt');
  });

  it('toasts instead of sending when the selection is too large', async () => {
    renderControl();
    const big = new File([new Uint8Array(300 * 1024)], 'big.bin');
    fireEvent.change(screen.getByTestId('reticulum-attach-file-input'), {
      target: { files: [big] },
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('chatPanel.attachment.errors.tooLarge', 'error');
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('rejects a non-raster photo without sending', async () => {
    renderControl();
    const svg = new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' });
    fireEvent.change(screen.getByTestId('reticulum-attach-photo-input'), {
      target: { files: [svg] },
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith(
        'chatPanel.attachment.errors.photoUnsupported',
        'error',
      );
    });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('surfaces send failures from the sender as toasts', async () => {
    sendMock.mockImplementationOnce((opts: { onFailure: (r: string) => void }) => {
      opts.onFailure('no_propagation_node');
      return Promise.resolve(false);
    });
    renderControl();
    fireEvent.change(screen.getByTestId('reticulum-attach-file-input'), {
      target: { files: [new File(['x'], 'a.txt')] },
    });
    await waitFor(() => {
      expect(addToast).toHaveBeenCalledWith('chatPanel.reticulumNoPropagationNode', 'error');
    });
  });

  it('shows progress for this DM only and cancels via the store id', async () => {
    const view = renderControl();
    act(() => {
      useReticulumAttachmentSendStore.getState().begin({
        id: 't1',
        identityId: IDENTITY,
        destination: DEST,
        fileName: 'a.txt',
        sizeBytes: 5,
        messageHash: 'ab'.repeat(32),
        progress: 0.5,
        cancelling: false,
      });
      useReticulumAttachmentSendStore.getState().begin({
        id: 't2',
        identityId: IDENTITY,
        destination: 0x9999,
        fileName: 'other.txt',
        sizeBytes: 5,
        messageHash: null,
        progress: null,
        cancelling: false,
      });
    });
    const bars = screen.getAllByRole('progressbar');
    expect(bars).toHaveLength(1);
    expect(bars[0].getAttribute('aria-valuenow')).toBe('50');
    expect(await axe(view.container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'chatPanel.attachment.cancelAria' }));
    expect(cancelMock).toHaveBeenCalledWith('t1');
  });

  it('disables the attach button while the composer is disabled', () => {
    renderControl(true);
    expect(screen.getByRole('button', { name: 'chatPanel.attachment.attachAria' })).toBeDisabled();
  });
});
