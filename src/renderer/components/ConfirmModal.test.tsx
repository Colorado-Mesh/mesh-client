import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal', () => {
  it('exposes alertdialog semantics with labelled title and described message', () => {
    render(
      <ConfirmModal
        title="Reboot Device"
        message="This will reboot the device."
        confirmLabel="Reboot"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const dialog = screen.getByRole('alertdialog', { name: 'Reboot Device' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    const message = screen.getByText('This will reboot the device.');
    expect(dialog).toHaveAttribute('aria-describedby', message.id);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <ConfirmModal
        title="Delete history"
        message="This cannot be undone."
        confirmLabel="Delete"
        danger
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('returns focus to the previously focused element on close', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'Open';
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <ConfirmModal
        title="Confirm"
        message="Are you sure?"
        confirmLabel="Yes"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    // Steal focus into the modal (jsdom often skips auto-focus when offsetParent is null).
    screen.getByRole('button', { name: 'Yes' }).focus();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Yes' }));
    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
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

  it('uses cancelLabel when provided', () => {
    render(
      <ConfirmModal
        title="Colorado Mesh MQTT"
        message="Are you in Colorado?"
        confirmLabel="I am in Colorado"
        cancelLabel="Switch to LetsMesh"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Switch to LetsMesh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'I am in Colorado' })).toBeInTheDocument();
  });

  it('omits the alt action button unless both alt props are provided', () => {
    render(
      <ConfirmModal
        title="Open address"
        message="Which one?"
        confirmLabel="Nomad page"
        altActionLabel="Direct message"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Direct message' })).toBeNull();
  });

  it('calls onAltAction when the alt action button is clicked', async () => {
    const user = userEvent.setup();
    const onAltAction = vi.fn();
    const onConfirm = vi.fn();

    render(
      <ConfirmModal
        title="Open address"
        message="Which one?"
        confirmLabel="Nomad page"
        altActionLabel="Direct message"
        onAltAction={onAltAction}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Direct message' }));
    expect(onAltAction).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('has no axe violations with an alt action', async () => {
    const { container } = render(
      <ConfirmModal
        title="Open address"
        message="Which one?"
        confirmLabel="Nomad page"
        altActionLabel="Direct message"
        onAltAction={vi.fn()}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
