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
