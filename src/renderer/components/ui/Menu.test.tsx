import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { LabeledMenuButton, MenuButton, type MenuEntry, SplitButton } from './Menu';

function entries(onRadio = vi.fn(), onQuit = vi.fn()): MenuEntry[] {
  return [
    { id: 'radio', label: 'Disconnect radio', onSelect: onRadio },
    'separator',
    {
      id: 'quit',
      label: 'Disconnect all and quit',
      description: 'Radio and MQTT, then quit the app',
      tone: 'danger',
      onSelect: onQuit,
    },
  ];
}

describe('SplitButton', () => {
  it('runs the main action from the main button', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <SplitButton
        label="Disconnect"
        onClick={onClick}
        groupLabel="Disconnect radio"
        menuTriggerLabel="More disconnect options"
        menuLabel="Disconnect options"
        entries={entries()}
        variant="danger"
      />,
    );
    expect(screen.getByRole('group', { name: 'Disconnect radio' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('opens the menu, focuses the first item and runs the chosen item', async () => {
    const user = userEvent.setup();
    const onQuit = vi.fn();
    render(
      <SplitButton
        label="Disconnect"
        onClick={vi.fn()}
        groupLabel="Disconnect radio"
        menuTriggerLabel="More disconnect options"
        menuLabel="Disconnect options"
        entries={entries(vi.fn(), onQuit)}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'More disconnect options' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Disconnect options' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', menu.id);
    expect(screen.getByRole('menuitem', { name: 'Disconnect radio' })).toHaveFocus();
    await user.click(screen.getByRole('menuitem', { name: /Disconnect all and quit/ }));
    expect(onQuit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('moves with arrow keys, Home and End and closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <SplitButton
        label="Export"
        onClick={vi.fn()}
        groupLabel="Export"
        menuTriggerLabel="Export format"
        menuLabel="Export formats"
        entries={[
          { id: 'json', label: 'JSON', onSelect: vi.fn() },
          { id: 'csv', label: 'CSV', onSelect: vi.fn() },
          { id: 'gpx', label: 'GPX', onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Export format' });
    await user.click(trigger);
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'CSV' })).toHaveFocus();
    // Disabled items are skipped: wraps back to the first.
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'JSON' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(screen.getByRole('menuitem', { name: 'CSV' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(screen.getByRole('menuitem', { name: 'JSON' })).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside click', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">Elsewhere</button>
        <SplitButton
          label="Export"
          onClick={vi.fn()}
          groupLabel="Export"
          menuTriggerLabel="Export format"
          menuLabel="Export formats"
          entries={[{ id: 'json', label: 'JSON', onSelect: vi.fn() }]}
        />
      </div>,
    );
    await user.click(screen.getByRole('button', { name: 'Export format' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('has no axe violations with the menu open', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <SplitButton
        label="Disconnect"
        onClick={vi.fn()}
        groupLabel="Disconnect radio"
        menuTriggerLabel="More disconnect options"
        menuLabel="Disconnect options"
        entries={entries()}
        variant="danger"
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More disconnect options' }));
    // The menu is portaled to <body>; check the trigger group and the menu separately.
    const menu = screen.getByRole('menu');
    hydrateAxeThemeColors(container);
    hydrateAxeThemeColors(menu);
    expect(await axe(container)).toHaveNoViolations();
    expect(await axe(menu)).toHaveNoViolations();
  });
});

describe('MenuButton', () => {
  it('opens an overflow menu from an icon button', async () => {
    const user = userEvent.setup();
    const onPing = vi.fn();
    render(
      <MenuButton
        aria-label="More actions for Ridge Fox"
        icon={<span aria-hidden="true">...</span>}
        menuLabel="Actions for Ridge Fox"
        entries={[{ id: 'ping', label: 'Ping', onSelect: onPing }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for Ridge Fox' }));
    await user.click(screen.getByRole('menuitem', { name: 'Ping' }));
    expect(onPing).toHaveBeenCalledTimes(1);
  });

  it('still closes on Escape when every item is disabled', async () => {
    const user = userEvent.setup();
    render(
      <MenuButton
        aria-label="More actions for Ridge Fox"
        icon={<span aria-hidden="true">...</span>}
        menuLabel="Actions for Ridge Fox"
        entries={[{ id: 'ping', label: 'Ping', disabled: true, onSelect: vi.fn() }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for Ridge Fox' }));
    const menu = screen.getByRole('menu', { name: 'Actions for Ridge Fox' });
    // No enabled item to focus, so the menu itself takes focus and hears Escape.
    expect(menu).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('LabeledMenuButton', () => {
  it('opens its menu from a labelled trigger and runs the chosen item', async () => {
    const user = userEvent.setup();
    const onCsv = vi.fn();
    const { container } = render(
      <LabeledMenuButton
        label="Export"
        menuLabel="Export formats"
        entries={[
          { id: 'json', label: 'Export JSON', onSelect: vi.fn() },
          { id: 'csv', label: 'Export CSV', onSelect: onCsv },
        ]}
      />,
    );
    const trigger = screen.getByRole('button', { name: 'Export' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('menuitem', { name: 'Export CSV' }));
    expect(onCsv).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
