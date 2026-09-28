import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { MeshcoreFloodAdvertHeaderButton } from './MeshcoreFloodAdvertHeaderButton';
import { ToastProvider } from './Toast';

function renderButton(onSend = vi.fn().mockResolvedValue(undefined), disabled = false) {
  render(
    <ToastProvider>
      <MeshcoreFloodAdvertHeaderButton disabled={disabled} onSend={onSend} />
    </ToastProvider>,
  );
  return onSend;
}

function renderSplit(onSendZeroHop = vi.fn().mockResolvedValue(undefined), disabled = false) {
  const onSend = vi.fn().mockResolvedValue(undefined);
  render(
    <ToastProvider>
      <MeshcoreFloodAdvertHeaderButton
        disabled={disabled}
        onSend={onSend}
        onSendZeroHop={onSendZeroHop}
      />
    </ToastProvider>,
  );
  return { onSend, onSendZeroHop };
}

describe('MeshcoreFloodAdvertHeaderButton zero-hop (#1100)', () => {
  it('keeps Flood Advert one click and offers Zero-hop Advert from the chevron', async () => {
    const user = userEvent.setup();
    const { onSend, onSendZeroHop } = renderSplit();

    await user.click(screen.getByRole('button', { name: 'Send flood advert' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSendZeroHop).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'More advert options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Zero-hop Advert' }));
    expect(onSendZeroHop).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Zero-hop advert sent')).toBeInTheDocument();
  });

  it('reports a failed zero-hop advert', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const user = userEvent.setup();
    renderSplit(vi.fn().mockRejectedValue(new Error('radio offline')));
    await user.click(screen.getByRole('button', { name: 'More advert options' }));
    await user.click(screen.getByRole('menuitem', { name: 'Zero-hop Advert' }));
    expect(await screen.findByText('Advert failed: radio offline')).toBeInTheDocument();
    expect(warn).toHaveBeenCalledWith(
      '[MeshcoreFloodAdvertHeaderButton] zero-hop send failed radio offline',
    );
    warn.mockRestore();
  });

  it('disables both parts, and says why, until the radio is connected', () => {
    renderSplit(undefined, true);
    const options = screen.getByRole('button', { name: 'More advert options' });
    expect(options).toBeDisabled();
    expect(options).toHaveAttribute('title', 'Available once a MeshCore radio is connected');
    expect(screen.getByRole('button', { name: 'Send flood advert' })).toBeDisabled();
  });

  it('shows no chevron without a zero-hop sender', () => {
    renderButton();
    expect(screen.queryByRole('button', { name: 'More advert options' })).toBeNull();
  });
});

describe('MeshcoreFloodAdvertHeaderButton', () => {
  it('sends a flood advert once and reports success', async () => {
    const user = userEvent.setup();
    const onSend = renderButton();

    await user.click(screen.getByRole('button', { name: 'Send flood advert' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Flood advert sent')).toBeInTheDocument();
  });

  it('stays disabled when the companion radio is unavailable', async () => {
    const user = userEvent.setup();
    const onSend = renderButton(undefined, true);
    const button = screen.getByRole('button', { name: 'Send flood advert' });

    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('says why it is unavailable instead of naming the action', () => {
    renderButton(undefined, true);
    const button = screen.getByRole('button', { name: 'Send flood advert' });
    expect(button).toHaveAttribute('title', 'Available once a MeshCore radio is connected');
  });

  it('names the action in its tooltip when it can be used', () => {
    renderButton();
    const button = screen.getByRole('button', { name: 'Send flood advert' });
    expect(button).toHaveAttribute('title', 'Send flood advert');
  });

  it('prevents another send while one is in progress', async () => {
    let resolveSend: (() => void) | undefined;
    const onSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const user = userEvent.setup();
    renderButton(onSend);
    const button = screen.getByRole('button', { name: 'Send flood advert' });

    await user.click(button);
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onSend).toHaveBeenCalledTimes(1);

    resolveSend?.();
    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });

  it('reports a rejected send and allows retrying', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onSend = vi.fn().mockRejectedValue(new Error('radio offline'));
    const user = userEvent.setup();
    renderButton(onSend);
    const button = screen.getByRole('button', { name: 'Send flood advert' });

    await user.click(button);

    expect(await screen.findByText('Advert failed: radio offline')).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(warn).toHaveBeenCalledWith(
      '[MeshcoreFloodAdvertHeaderButton] send failed radio offline',
    );
    warn.mockRestore();
  });
});
