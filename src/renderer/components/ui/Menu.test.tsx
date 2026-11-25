import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { LabeledMenuButton, MenuButton, type MenuEntry, type MenuItem, SplitButton } from './Menu';

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

describe('Menu radio groups', () => {
  function routeEntries(onDirect = vi.fn()): MenuEntry[] {
    return [
      { id: 'status', label: 'Request status', onSelect: vi.fn() },
      'separator',
      {
        id: 'route',
        label: 'When a reply is missed',
        items: [
          { id: 'auto', label: 'Auto', checked: true, onSelect: vi.fn() },
          {
            id: 'direct',
            label: 'Direct only',
            description: 'Resend once on the same route',
            checked: false,
            onSelect: onDirect,
          },
        ],
      },
    ];
  }

  async function openMenu(entries: MenuEntry[]) {
    const user = userEvent.setup();
    const utils = render(
      <MenuButton
        aria-label="More actions for Ridge Fox"
        icon={<span aria-hidden="true">...</span>}
        menuLabel="Actions for Ridge Fox"
        entries={entries}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for Ridge Fox' }));
    return { user, ...utils };
  }

  it('renders a labelled group of radio items with their checked state', async () => {
    await openMenu(routeEntries());
    const group = screen.getByRole('group', { name: 'When a reply is missed' });
    const auto = within(group).getByRole('menuitemradio', { name: 'Auto' });
    const direct = within(group).getByRole('menuitemradio', { name: 'Direct only' });
    expect(auto).toHaveAttribute('aria-checked', 'true');
    expect(direct).toHaveAttribute('aria-checked', 'false');
    expect(direct).toHaveAccessibleDescription('Resend once on the same route');
    // Plain items keep their role.
    expect(screen.getByRole('menuitem', { name: 'Request status' })).toBeInTheDocument();
  });

  it('moves into the radio items with the arrow keys and runs the chosen one', async () => {
    const onDirect = vi.fn();
    const { user } = await openMenu(routeEntries(onDirect));
    expect(screen.getByRole('menuitem', { name: 'Request status' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Auto' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Direct only' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onDirect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('skips a disabled radio item when moving with the arrow keys', async () => {
    const entries = routeEntries();
    const group = entries[2] as Exclude<MenuEntry, 'separator'> & { items: MenuItem[] };
    group.items[0] = { ...group.items[0], disabled: true };
    const { user } = await openMenu(entries);
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Direct only' })).toHaveFocus();
  });

  it('has no axe violations with a radio group open', async () => {
    await openMenu(routeEntries());
    const menu = screen.getByRole('menu');
    hydrateAxeThemeColors(menu);
    expect(await axe(menu)).toHaveNoViolations();
  });
});

describe('Menu placement in a short window', () => {
  const originalInnerHeight = window.innerHeight;

  afterEach(() => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight,
    });
    vi.restoreAllMocks();
  });

  /** Lay out a trigger at `triggerTop` and a menu `menuHeight` tall in a window `height` tall. */
  function stubLayout(opts: { height: number; triggerTop: number; menuHeight: number }) {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: opts.height });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('aria-haspopup') === 'menu') {
        return DOMRect.fromRect({ x: 900, y: opts.triggerTop, width: 30, height: 30 });
      }
      return DOMRect.fromRect({ x: 0, y: 0, width: 0, height: 0 });
    });
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute('role') !== 'menu') return 0;
      // Like a browser: an applied max-height caps the laid-out height.
      const cap = parseFloat(this.style.maxHeight);
      return Number.isFinite(cap) ? Math.min(opts.menuHeight, cap) : opts.menuHeight;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.getAttribute('role') === 'menu' ? 240 : 0;
    });
  }

  async function openActions() {
    const user = userEvent.setup();
    render(
      <MenuButton
        aria-label="More actions for Ridge Fox"
        icon={<span aria-hidden="true">...</span>}
        menuLabel="Actions for Ridge Fox"
        entries={[{ id: 'ping', label: 'Ping', onSelect: vi.fn() }]}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'More actions for Ridge Fox' }));
    return screen.getByRole('menu');
  }

  it('opens below without a height cap when it fits', async () => {
    stubLayout({ height: 800, triggerTop: 250, menuHeight: 400 });
    const menu = await openActions();
    expect(menu.style.top).toBe('284px');
    expect(menu.style.maxHeight).toBe('');
  });

  it('opens above when only the space above fits', async () => {
    stubLayout({ height: 800, triggerTop: 700, menuHeight: 400 });
    const menu = await openActions();
    expect(menu.style.top).toBe('296px');
    expect(menu.style.maxHeight).toBe('');
  });

  it('caps the height and scrolls on the roomier side instead of covering the trigger', async () => {
    // 520 px of menu, 508 px free below the trigger, 238 px above: neither fits.
    stubLayout({ height: 800, triggerTop: 250, menuHeight: 520 });
    const menu = await openActions();
    expect(menu.style.top).toBe('284px');
    expect(menu.style.maxHeight).toBe('508px');
    expect(menu.style.overflowY).toBe('auto');
  });

  it('stays open when the capped menu scrolls its own items', async () => {
    stubLayout({ height: 800, triggerTop: 250, menuHeight: 520 });
    const menu = await openActions();
    fireEvent.scroll(menu);
    expect(screen.getByRole('menu')).toBeInTheDocument();
    // A scroll anywhere else still closes it.
    fireEvent.scroll(window);
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('caps the height again when the menu is closed and opened a second time', async () => {
    stubLayout({ height: 800, triggerTop: 250, menuHeight: 520 });
    const user = userEvent.setup();
    await openActions();
    const trigger = screen.getByRole('button', { name: 'More actions for Ridge Fox' });
    await user.click(trigger);
    expect(screen.queryByRole('menu')).toBeNull();
    await user.click(trigger);
    const menu = screen.getByRole('menu');
    expect(menu.style.top).toBe('284px');
    expect(menu.style.maxHeight).toBe('508px');
  });

  it('caps the height above the trigger when there is more room above', async () => {
    stubLayout({ height: 600, triggerTop: 400, menuHeight: 504 });
    const menu = await openActions();
    expect(menu.style.top).toBe('8px');
    expect(menu.style.maxHeight).toBe('388px');
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
