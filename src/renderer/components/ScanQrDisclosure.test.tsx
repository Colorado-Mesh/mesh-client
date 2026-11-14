import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ScanQrDisclosure from '@/renderer/components/ScanQrDisclosure';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/renderer/components/QrIngestControl', () => ({
  default: ({ onDecoded, disabled }: { onDecoded: (text: string) => void; disabled?: boolean }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label="mock-qr-ingest"
      onClick={() => {
        onDecoded('decoded-text');
      }}
    >
      ingest
    </button>
  ),
}));

describe('ScanQrDisclosure', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('toggles aria-expanded and mounts the panel', async () => {
    const user = userEvent.setup();
    render(<ScanQrDisclosure onDecoded={vi.fn()} triggerAriaLabel="qrIngest.scanContactQrAria" />);
    const trigger = screen.getByRole('button', { name: 'qrIngest.scanContactQrAria' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('mock-qr-ingest')).toBeNull();
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('mock-qr-ingest')).toBeInTheDocument();
  });

  it('disables trigger and decode buttons', async () => {
    const user = userEvent.setup();
    render(
      <ScanQrDisclosure
        onDecoded={vi.fn()}
        disabled
        disabledHint="qrIngest.connectToScan"
        triggerAriaLabel="qrIngest.scanQrAria"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'qrIngest.scanQrAria' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    // Disabled trigger should not expand.
    expect(screen.queryByLabelText('mock-qr-ingest')).toBeNull();
  });

  it('dispatches onDecoded and collapses by default', async () => {
    const user = userEvent.setup();
    const onDecoded = vi.fn().mockResolvedValue(undefined);
    render(
      <ScanQrDisclosure
        onDecoded={onDecoded}
        triggerAriaLabel="qrIngest.scanQrAria"
        label="Scan"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'qrIngest.scanQrAria' }));
    await user.click(screen.getByLabelText('mock-qr-ingest'));
    await waitFor(() => {
      expect(onDecoded).toHaveBeenCalledWith('decoded-text');
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'qrIngest.scanQrAria' })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    });
  });

  it('keeps open when closeOnDecoded is false', async () => {
    const user = userEvent.setup();
    render(
      <ScanQrDisclosure
        onDecoded={vi.fn()}
        closeOnDecoded={false}
        triggerAriaLabel="qrIngest.scanQrAria"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'qrIngest.scanQrAria' }));
    await user.click(screen.getByLabelText('mock-qr-ingest'));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'qrIngest.scanQrAria' })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });

  it('sets data-setting-anchor when anchorId is provided', () => {
    const { container } = render(
      <ScanQrDisclosure
        onDecoded={vi.fn()}
        anchorId="nodes.contacts.scanQr"
        triggerAriaLabel="qrIngest.scanContactQrAria"
      />,
    );
    expect(container.querySelector('[data-setting-anchor="nodes.contacts.scanQr"]')).not.toBeNull();
  });

  it('renders a toolbar Button and opens a portaled popover', async () => {
    const user = userEvent.setup();
    render(
      <ScanQrDisclosure
        onDecoded={vi.fn()}
        triggerStyle="toolbar"
        triggerAriaLabel="qrIngest.scanContactQrAria"
        label="Scan contact QR"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'qrIngest.scanContactQrAria' });
    expect(trigger.className).toMatch(/border-secondary-dark/);
    expect(trigger.className).toMatch(/bg-sidebar-active-bg/);
    await user.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Scan contact QR' });
    expect(dialog.className).toMatch(/fixed/);
    expect(dialog.parentElement).toBe(document.body);
    expect(screen.getByLabelText('mock-qr-ingest')).toBeInTheDocument();
  });

  it('closes the toolbar popover on outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button" aria-label="outside">
          outside
        </button>
        <ScanQrDisclosure
          onDecoded={vi.fn()}
          triggerStyle="toolbar"
          triggerAriaLabel="qrIngest.scanContactQrAria"
          label="Scan contact QR"
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'qrIngest.scanContactQrAria' }));
    expect(screen.getByRole('dialog', { name: 'Scan contact QR' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'outside' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Scan contact QR' })).toBeNull();
    });
  });

  it('does not close a newer session when an earlier decode resolves late', async () => {
    const user = userEvent.setup();
    let resolveFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    let call = 0;
    const onDecoded = vi.fn().mockImplementation(() => {
      call += 1;
      return call === 1 ? first : Promise.resolve();
    });
    render(
      <ScanQrDisclosure
        onDecoded={onDecoded}
        triggerAriaLabel="qrIngest.scanQrAria"
        label="Scan"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'qrIngest.scanQrAria' });
    await user.click(trigger);
    await user.click(screen.getByLabelText('mock-qr-ingest'));
    expect(onDecoded).toHaveBeenCalledTimes(1);
    // Close and reopen a new session before the first decode settles.
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('mock-qr-ingest')).toBeInTheDocument();
    resolveFirst();
    await waitFor(() => {
      expect(onDecoded).toHaveBeenCalledTimes(1);
    });
    // New session must remain open despite the stale decode completing.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('mock-qr-ingest')).toBeInTheDocument();
  });
});
