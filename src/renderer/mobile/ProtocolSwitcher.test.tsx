import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { ProtocolSwitcher, type ProtocolSwitcherProps } from './ProtocolSwitcher';

const contexts: ProtocolSwitcherProps['contexts'] = {
  meshtastic: { radioName: 'Trail radio', connected: true, unreadCount: 0 },
  meshcore: { radioName: 'Basecamp radio', connected: false, unreadCount: 3 },
  reticulum: { radioName: 'Field RNode', connected: true, unreadCount: 1 },
};

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    },
  });
});

afterAll(() => {
  if (originalShowModal) {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShowModal);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  }
  if (originalClose) {
    Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  }
});

describe('mobile ProtocolSwitcher', () => {
  it('opens a labelled modal and focuses the selected protocol', async () => {
    const user = userEvent.setup();
    render(<ProtocolSwitcher protocol="meshcore" contexts={contexts} onSelect={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Switch protocol, current MeshCore' });
    expect(trigger).toHaveTextContent('MeshCore');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Choose a protocol' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(within(dialog).getByRole('radio', { name: 'Switch to MeshCore' })).toHaveFocus();
    expect(within(dialog).getByRole('radio', { name: 'Switch to MeshCore' })).toBeChecked();
    expect(within(dialog).getByText('Basecamp radio')).toBeInTheDocument();
    expect(within(dialog).getByText('3 unread, sample')).toBeInTheDocument();
    expect(within(dialog).getByText('No radio connected')).toBeInTheDocument();
  });

  it('calls the controlled selection callback and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' });
    await user.click(trigger);
    await user.click(screen.getByRole('radio', { name: 'Switch to Reticulum' }));

    expect(onSelect).toHaveBeenCalledExactlyOnceWith('reticulum');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes an already selected card without changing protocol', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProtocolSwitcher protocol="meshcore" contexts={contexts} onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Switch protocol, current MeshCore' });
    await user.click(trigger);
    await user.click(screen.getByRole('radio', { name: 'Switch to MeshCore' }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('supports keyboard selection through the native radio group', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={onSelect} />);
    const trigger = screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' });
    await user.click(trigger);
    await user.keyboard('{ArrowDown}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('meshcore');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('wraps Tab focus inside the chooser', async () => {
    const user = userEvent.setup();
    render(<ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' }));
    const selected = screen.getByRole('radio', { name: 'Switch to Meshtastic' });
    const close = screen.getByRole('button', { name: 'Close protocol chooser' });
    expect(selected).toHaveFocus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(selected).toHaveFocus();
    await user.tab({ shift: true });
    expect(close).toHaveFocus();
  });

  it.each(['escape', 'cancel', 'backdrop', 'close'] as const)(
    'dismisses through %s and restores the opener',
    async (method) => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      render(<ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={onSelect} />);
      const trigger = screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' });
      await user.click(trigger);
      const dialog = screen.getByRole('dialog');
      if (method === 'escape') await user.keyboard('{Escape}');
      else if (method === 'cancel') fireEvent(dialog, new Event('cancel', { cancelable: true }));
      else if (method === 'backdrop') fireEvent.click(dialog);
      else await user.click(screen.getByRole('button', { name: 'Close protocol chooser' }));

      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(onSelect).not.toHaveBeenCalled();
    },
  );

  it('renders changed protocol and context values from its parent', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={vi.fn()} />,
    );
    rerender(
      <ProtocolSwitcher
        protocol="reticulum"
        contexts={{
          ...contexts,
          reticulum: { radioName: 'RNode at camp', connected: false, unreadCount: 12 },
        }}
        onSelect={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Switch protocol, current Reticulum' }));
    expect(screen.getByRole('radio', { name: 'Switch to Reticulum' })).toHaveFocus();
    expect(screen.getByText('RNode at camp')).toBeInTheDocument();
    expect(screen.getByText('12 unread, sample')).toBeInTheDocument();
  });

  it('uses a compact popover on wide shells and a sheet when the shell becomes compact', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <div className="mobile-shell" data-wide="true">
        <ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={onSelect} />
      </div>,
    );
    const trigger = screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' });
    const shell = trigger.closest('.mobile-shell');
    expect(shell).not.toBeNull();
    if (!shell) throw new Error('Test shell is missing');
    vi.spyOn(shell, 'getBoundingClientRect').mockReturnValue(new DOMRect(40, 40, 900, 700));
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(new DOMRect(700, 80, 160, 48));
    await user.click(trigger);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('data-presentation', 'popover');
    expect(dialog.style.getPropertyValue('--protocol-sheet-width')).toBe('360px');
    expect(dialog.style.getPropertyValue('--protocol-sheet-top')).toBe('136px');
    expect(screen.getByRole('radio', { name: 'Switch to Meshtastic' })).toHaveFocus();

    rerender(
      <div className="mobile-shell" data-wide="false">
        <ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={onSelect} />
      </div>,
    );
    await waitFor(() => {
      expect(dialog).toHaveAttribute('data-presentation', 'sheet');
    });
    expect(dialog.style.getPropertyValue('--protocol-sheet-width')).toBe('720px');
    expect(dialog).toHaveAttribute('open');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('has no axe violations with protocol colors and unread badges', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <ProtocolSwitcher protocol="meshtastic" contexts={contexts} onSelect={vi.fn()} />,
    );
    await user.click(screen.getByRole('button', { name: 'Switch protocol, current Meshtastic' }));
    hydrateAxeThemeColors(container);
    expect(await axe(screen.getByRole('dialog'))).toHaveNoViolations();
  });
});
