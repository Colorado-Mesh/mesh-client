import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import QrIngestControl, {
  resetQrIngestPasteOwnershipForTests,
} from '@/renderer/components/QrIngestControl';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/lib/decodeQrFromImageSource', () => ({
  decodeQrFromBlob: vi.fn(() => Promise.resolve('decoded-from-image')),
  decodeQrFromFile: vi.fn(() => Promise.resolve('decoded-from-file')),
  decodeQrFromImageData: vi.fn(() => null),
}));

function dispatchPaste(data: { image?: Blob; text?: string }): void {
  const items: DataTransferItem[] = [];
  if (data.image) {
    const blob = data.image;
    items.push({
      kind: 'file',
      type: blob.type || 'image/png',
      getAsFile: () => new File([blob], 'qr.png', { type: blob.type || 'image/png' }),
      getAsString: () => {},
      webkitGetAsEntry: () => null,
    });
  }
  // jsdom has no ClipboardEvent; attach clipboardData onto a plain Event.
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: {
      items,
      getData: (type: string) => (type === 'text/plain' ? (data.text ?? '') : ''),
      types: data.image ? ['Files'] : data.text ? ['text/plain'] : [],
    },
  });
  document.dispatchEvent(event);
}

describe('QrIngestControl paste', () => {
  beforeEach(() => {
    resetQrIngestPasteOwnershipForTests();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('accepts a document paste of an image after the paste target is focused', async () => {
    const user = userEvent.setup();
    const onDecoded = vi.fn();
    render(<QrIngestControl onDecoded={onDecoded} />);
    const target = screen.getByRole('group', { name: 'qrIngest.pasteTargetAria' });
    await user.click(target);
    dispatchPaste({ image: new Blob(['x'], { type: 'image/png' }) });
    await waitFor(() => {
      expect(onDecoded).toHaveBeenCalledWith('decoded-from-image');
    });
  });

  it('accepts a document paste of link text while the control is active', async () => {
    const onDecoded = vi.fn();
    render(<QrIngestControl onDecoded={onDecoded} focusOnMount />);
    await waitFor(() => {
      expect(screen.getByRole('group', { name: 'qrIngest.pasteTargetAria' })).toHaveFocus();
    });
    dispatchPaste({ text: 'meshcore://contact/add?n=Alice' });
    await waitFor(() => {
      expect(onDecoded).toHaveBeenCalledWith('meshcore://contact/add?n=Alice');
    });
  });

  it('ignores document paste when another control is active', async () => {
    const user = userEvent.setup();
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <>
        <QrIngestControl onDecoded={onA} />
        <QrIngestControl onDecoded={onB} />
      </>,
    );
    const targets = screen.getAllByRole('group', { name: 'qrIngest.pasteTargetAria' });
    await user.click(targets[1]);
    dispatchPaste({ text: 'meshcore://channel/add?n=ops' });
    await waitFor(() => {
      expect(onB).toHaveBeenCalledWith('meshcore://channel/add?n=ops');
    });
    expect(onA).not.toHaveBeenCalled();
  });

  it('does not steal paste from an outside textarea even if previously armed', async () => {
    const user = userEvent.setup();
    const onDecoded = vi.fn();
    render(
      <>
        <QrIngestControl onDecoded={onDecoded} />
        <textarea aria-label="backup" />
      </>,
    );
    await user.click(screen.getByRole('group', { name: 'qrIngest.pasteTargetAria' }));
    await user.click(screen.getByLabelText('backup'));
    dispatchPaste({ text: 'null' });
    expect(onDecoded).not.toHaveBeenCalled();
  });

  it('gives focused scan control precedence over a hovered control', async () => {
    const user = userEvent.setup();
    const onA = vi.fn();
    const onB = vi.fn();
    render(
      <>
        <QrIngestControl onDecoded={onA} />
        <QrIngestControl onDecoded={onB} />
      </>,
    );
    const targets = screen.getAllByRole('group', { name: 'qrIngest.pasteTargetAria' });
    await user.click(targets[0]);
    // Hover B without clicking — must not steal paste from focused A.
    targets[1].dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
    dispatchPaste({ text: 'meshcore://contact/add?n=FocusWins' });
    await waitFor(() => {
      expect(onA).toHaveBeenCalledWith('meshcore://contact/add?n=FocusWins');
    });
    expect(onB).not.toHaveBeenCalled();
  });

  it('stops the camera when disabled during an active scan', async () => {
    const user = userEvent.setup();
    const trackStop = vi.fn();
    const mockStream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(window.electronAPI.media, 'ensureCameraAccess').mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    const cancelRaf = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);

    const onDecoded = vi.fn();
    const { rerender } = render(<QrIngestControl onDecoded={onDecoded} />);
    await user.click(screen.getByRole('button', { name: 'qrIngest.scanCameraAria' }));
    await waitFor(() => {
      expect(screen.getByLabelText('qrIngest.cameraPreviewAria')).toBeInTheDocument();
    });

    rerender(<QrIngestControl onDecoded={onDecoded} disabled />);
    await waitFor(() => {
      expect(trackStop).toHaveBeenCalled();
      expect(cancelRaf).toHaveBeenCalled();
    });
    expect(screen.queryByLabelText('qrIngest.cameraPreviewAria')).toBeNull();
  });

  it('stops the camera when the scanner is hidden inside closed details', async () => {
    const user = userEvent.setup();
    const trackStop = vi.fn();
    const mockStream = {
      getTracks: () => [{ stop: trackStop }],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.spyOn(window.electronAPI.media, 'ensureCameraAccess').mockResolvedValue({
      granted: true,
      status: 'granted',
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    let rafCb: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCb = cb;
      return 1;
    });

    const onDecoded = vi.fn();
    render(
      <details open>
        <summary>Channels</summary>
        <QrIngestControl onDecoded={onDecoded} />
      </details>,
    );
    await user.click(screen.getByRole('button', { name: 'qrIngest.scanCameraAria' }));
    await waitFor(() => {
      expect(screen.getByLabelText('qrIngest.cameraPreviewAria')).toBeInTheDocument();
    });

    const details = screen.getByText('Channels').closest('details');
    expect(details).not.toBeNull();
    details!.open = false;
    rafCb?.(0);
    await waitFor(() => {
      expect(trackStop).toHaveBeenCalled();
    });
  });

  it('ignores paste after Channels collapse hides the scanner', async () => {
    const user = userEvent.setup();
    const onDecoded = vi.fn();
    render(
      <details open>
        <summary>Channels</summary>
        <QrIngestControl onDecoded={onDecoded} />
      </details>,
    );
    const target = screen.getByRole('group', { name: 'qrIngest.pasteTargetAria' });
    await user.click(target);
    const details = target.closest('details');
    expect(details).not.toBeNull();
    details!.open = false;
    dispatchPaste({ text: 'meshcore://contact/add?n=Hidden' });
    expect(onDecoded).not.toHaveBeenCalled();
  });
});
