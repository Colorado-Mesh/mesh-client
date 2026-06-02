import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal', () => {
  it('exposes dialog semantics and labelled title', () => {
    render(
      <ConfirmModal
        title="Reboot Device"
        message="This will reboot the device."
        confirmLabel="Reboot"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Reboot Device' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('This will reboot the device.')).toBeInTheDocument();
  });

  it('calls onCancel when Escape is pressed', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ConfirmModal
        title="Confirm"
        message="Are you sure?"
        confirmLabel="Yes"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );

    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();

    render(
      <ConfirmModal
        title="Confirm"
        message="Are you sure?"
        confirmLabel="Yes"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Yes' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('disables confirm button when confirmDisabled is true', () => {
    render(
      <ConfirmModal
        title="Confirm"
        message="Are you sure?"
        confirmLabel="Yes"
        confirmDisabled
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Yes' })).toBeDisabled();
  });
});
