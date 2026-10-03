import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { computeTabMappings } from '@/renderer/lib/appTabMappings';
import type { LauncherSettingItem } from '@/renderer/lib/launcherDestinations';
import { computeNavSections } from '@/renderer/lib/navSections';
import { MESHCORE_CAPABILITIES } from '@/renderer/lib/radio/BaseRadioProvider';
import type { TabSlotId } from '@/renderer/lib/tabSlotIds';

import { PanelLauncher } from './PanelLauncher';

const LABELS: Record<string, string> = {
  'tabs.connection': 'Connection',
  'tabs.chat': 'Chat',
  'tabs.contacts': 'Contacts',
  'tabs.map': 'Map',
  'tabs.radio': 'Radio',
  'tabs.repeaters': 'Repeaters',
  'tabs.admin': 'Admin',
  'tabs.rooms': 'Rooms',
  'tabs.telemetry': 'Telemetry',
  'tabs.security': 'Security',
  'tabs.tak': 'TAK',
  'tabs.incident': 'Incident',
  'tabs.app': 'App',
  'tabs.diagnostics': 'Diagnostics',
  'tabs.stats': 'Stats',
  'tabs.sniffer': 'Sniffer',
  'tabs.rf': 'RF',
  'tabs.graph': 'Graph',
};
const labelT = ((key: string) => LABELS[key] ?? key) as TFunction;
const mappings = computeTabMappings(labelT, 'meshcore', MESHCORE_CAPABILITIES);
const sections = computeNavSections(mappings, MESHCORE_CAPABILITIES);
const tabIndexOf = (label: string) => mappings.displayTabLabels.indexOf(label);

function renderLauncher(
  overrides: Partial<{
    pins: TabSlotId[];
    platform: string;
    onOpenTab: (tabIndex: number) => void;
    onTogglePin: (slot: TabSlotId) => void;
    onClose: () => void;
  }> = {},
) {
  const props = {
    sections,
    badgeCounts: { Chat: 4, Rooms: 2 },
    pins: ['Chat', 'Nodes', 'Map', 'Connection'] as TabSlotId[],
    platform: 'linux',
    onOpenTab: vi.fn(),
    onTogglePin: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  return { ...render(<PanelLauncher {...props} />), props };
}

describe('PanelLauncher', () => {
  it('as a phone sheet, shows the header slot and focuses the sheet instead of the search field', () => {
    render(
      <PanelLauncher
        sections={sections}
        badgeCounts={{}}
        pins={[]}
        platform="linux"
        onOpenTab={vi.fn()}
        onTogglePin={vi.fn()}
        onClose={vi.fn()}
        variant="sheet"
        header={<div data-testid="sheet-header" />}
      />,
    );
    const sheet = screen.getByRole('dialog', { name: 'All panels' });
    expect(within(sheet).getByTestId('sheet-header')).toBeInTheDocument();
    expect(document.activeElement).toBe(sheet);
    expect(sheet.className).toContain('rounded-t-xl');
  });

  it('finds channels and contacts while searching and opens them', async () => {
    const user = userEvent.setup();
    const onOpenChannel = vi.fn();
    const onOpenContact = vi.fn();
    render(
      <PanelLauncher
        sections={sections}
        badgeCounts={{}}
        pins={[]}
        platform="linux"
        onOpenTab={vi.fn()}
        onTogglePin={vi.fn()}
        onClose={vi.fn()}
        channels={[
          { index: 0, name: 'Public', search: 'public' },
          { index: 3, name: '#weather', search: '#weather' },
        ]}
        contacts={[
          { id: '1', name: 'Trail Dave', detail: 'TD', search: 'trail dave td 00000001' },
          { id: '2', name: 'Weather Station', detail: 'WX', search: 'weather station wx 00000002' },
        ]}
        contactsLabel="Contacts"
        onOpenChannel={onOpenChannel}
        onOpenContact={onOpenContact}
      />,
    );
    const dialog = screen.getByRole('dialog', { name: 'All panels' });
    // Nothing is listed until the user types.
    expect(within(dialog).queryByRole('region', { name: 'Channels' })).toBeNull();

    const input = screen.getByRole('textbox', {
      name: 'Search panels, contacts, channels and settings',
    });
    await user.type(input, 'weather');
    const channels = within(dialog).getByRole('region', { name: 'Channels' });
    const contacts = within(dialog).getByRole('region', { name: 'Contacts' });
    expect(within(channels).getByRole('button', { name: '#weather' })).toBeInTheDocument();
    await user.click(within(contacts).getByRole('button', { name: /Weather Station/ }));
    expect(onOpenContact).toHaveBeenCalledWith('2');

    // Enter opens the first match when no panel matches.
    await user.clear(input);
    await user.type(input, 'public{Enter}');
    expect(onOpenChannel).toHaveBeenCalledWith(0);
  });

  it('focuses the search field as a dialog', () => {
    renderLauncher();
    expect(document.activeElement).toBe(
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' }),
    );
  });

  it('lists all 18 MeshCore panels grouped by section', () => {
    renderLauncher();
    const dialog = screen.getByRole('dialog', { name: 'All panels' });
    expect(within(dialog).getByText('18 panels')).toBeInTheDocument();
    for (const group of ['Chat', 'Network', 'Monitor', 'Device', 'Other']) {
      expect(within(dialog).getByRole('region', { name: group })).toBeInTheDocument();
    }
    const other = within(dialog).getByRole('region', { name: 'Other' });
    expect(within(other).getByRole('button', { name: 'Map' })).toBeInTheDocument();
    expect(within(other).getByRole('button', { name: 'Incident' })).toBeInTheDocument();
  });

  it('focuses the search field on open', () => {
    renderLauncher();
    expect(
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' }),
    ).toHaveFocus();
  });

  it('filters by label and opens the first match with Enter', async () => {
    const user = userEvent.setup();
    const { props } = renderLauncher();
    await user.type(
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' }),
      'snif',
    );
    expect(screen.getAllByRole('button', { name: /^(Sniffer)$/ })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Chat, 4 unread' })).toBeNull();
    await user.keyboard('{Enter}');
    expect(props.onOpenTab).toHaveBeenCalledWith(tabIndexOf('Sniffer'));
  });

  it('matches stable slot ids so "nodes" finds Contacts', async () => {
    const user = userEvent.setup();
    renderLauncher();
    await user.type(
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' }),
      'nodes',
    );
    expect(screen.getByRole('button', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderLauncher();
    await user.type(
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' }),
      'zzz',
    );
    expect(screen.getByText('No panels match your search')).toBeInTheDocument();
  });

  it('opens a panel on click', async () => {
    const user = userEvent.setup();
    const { props } = renderLauncher();
    await user.click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(props.onOpenTab).toHaveBeenCalledWith(tabIndexOf('Diagnostics'));
  });

  function activeEntryRows(): HTMLElement[] {
    return screen
      .getAllByRole('button')
      .filter(
        (button) =>
          button.hasAttribute('data-launcher-entry') &&
          button.classList.contains('bg-sidebar-active-bg'),
      );
  }

  it('moves the single highlight with the arrow keys and back to the search field', () => {
    renderLauncher();
    const input = screen.getByRole('textbox', {
      name: 'Search panels, contacts, channels and settings',
    });
    const chat = screen.getByRole('button', { name: 'Chat, 4 unread' });
    const rooms = screen.getByRole('button', { name: 'Rooms, 2 unread' });
    expect(activeEntryRows()).toEqual([chat]);
    expect(chat.className).toContain('focus-visible:outline-brand-green');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(rooms).toHaveFocus();
    expect(activeEntryRows()).toEqual([rooms]);

    fireEvent.keyDown(rooms, { key: 'ArrowDown' });
    const third = document.activeElement;
    expect(third).toHaveAttribute('data-launcher-entry');
    expect(third).not.toBe(rooms);
    fireEvent.keyDown(third as HTMLElement, { key: 'ArrowUp' });
    expect(rooms).toHaveFocus();
    fireEvent.keyDown(rooms, { key: 'ArrowUp' });
    expect(chat).toHaveFocus();
    fireEvent.keyDown(chat, { key: 'ArrowUp' });
    expect(input).toHaveFocus();
    expect(activeEntryRows()).toEqual([chat]);
  });

  it('ArrowDown after a search moves the highlight, and Enter opens that row', async () => {
    const user = userEvent.setup();
    const onOpenTab = vi.fn();
    renderLauncher({ onOpenTab });
    const input = screen.getByRole('textbox', {
      name: 'Search panels, contacts, channels and settings',
    });
    await user.type(input, 'a');
    const chat = screen.getByRole('button', { name: 'Chat, 4 unread' });
    const contacts = screen.getByRole('button', { name: 'Contacts' });
    expect(activeEntryRows()).toEqual([chat]);

    await user.keyboard('{ArrowDown}');
    expect(contacts).toHaveFocus();
    expect(activeEntryRows()).toEqual([contacts]);

    act(() => {
      input.focus();
    });
    await user.keyboard('{Enter}');
    expect(onOpenTab).toHaveBeenCalledExactlyOnceWith(tabIndexOf('Contacts'));

    onOpenTab.mockClear();
    act(() => {
      contacts.focus();
    });
    await user.keyboard('{Enter}');
    expect(onOpenTab).toHaveBeenCalledExactlyOnceWith(tabIndexOf('Contacts'));
  });

  it('sends typing on a row back to the search field', () => {
    renderLauncher();
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' }),
      { key: 'ArrowDown' },
    );
    fireEvent.keyDown(document.activeElement!, { key: 'r' });
    const input = screen.getByRole('textbox', {
      name: 'Search panels, contacts, channels and settings',
    });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('r');
  });

  it('shows shortcut hints for pinned panels with the platform modifier', () => {
    const { unmount } = renderLauncher({ platform: 'linux' });
    expect(screen.getByRole('button', { name: 'Map' })).toHaveTextContent('Ctrl+3');
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+3',
    );
    unmount();
    renderLauncher({ platform: 'darwin' });
    expect(screen.getByRole('button', { name: 'Map' })).toHaveTextContent('⌘3');
    expect(screen.getByRole('button', { name: 'Map' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Meta+3',
    );
  });

  it('toggles pins from the pin button and disables new pins when full', async () => {
    const user = userEvent.setup();
    const { props } = renderLauncher();
    expect(screen.getByRole('button', { name: 'Unpin Map' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Unpin Map' }));
    expect(props.onTogglePin).toHaveBeenCalledWith('Map');
    const pinGraph = screen.getByRole('button', { name: 'Pin Graph' });
    expect(pinGraph).toBeDisabled();
    expect(pinGraph).toHaveAttribute('title', 'Up to 4 panels can be pinned. Unpin one first.');
  });

  it.each([
    ['linux', { ctrlKey: true }],
    ['win32', { ctrlKey: true }],
    ['darwin', { metaKey: true }],
  ] as const)('toggles the focused row pin with the modifier plus P on %s', (platform, mod) => {
    const onTogglePin = vi.fn();
    renderLauncher({ platform, pins: ['Chat'], onTogglePin });
    const row = screen.getByRole('button', { name: 'Graph' });
    act(() => {
      row.focus();
    });
    fireEvent.keyDown(row, { key: 'p', code: 'KeyP', ...mod });
    expect(onTogglePin).toHaveBeenCalledWith('Graph');
  });

  it('closes on Escape and on backdrop click', async () => {
    const user = userEvent.setup();
    const { props } = renderLauncher();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it('keeps Tab focus inside the dialog', () => {
    renderLauncher();
    const dialog = screen.getByRole('dialog', { name: 'All panels' });
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'),
    );
    const last = focusables[focusables.length - 1];
    act(() => {
      last?.focus();
    });
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' }),
    ).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
  });

  it('returns focus to the opener when it unmounts', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = renderLauncher();
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('has no axe violations', async () => {
    const { container } = renderLauncher();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  describe('settings group', () => {
    const SETTINGS: LauncherSettingItem[] = [
      {
        id: 'radio.contacts.autoOffload',
        slot: 'Radio',
        label: 'Auto-offload when full',
        detail: 'Contact management',
        search: 'auto-offload when full offload contacts',
      },
      {
        id: 'radio.contacts.offloadContacts',
        slot: 'Radio',
        label: 'Offload',
        detail: 'Contacts',
        search: 'offload contacts database',
      },
    ];

    function renderWithSettings(
      overrides: Partial<{
        onOpenSetting: (item: LauncherSettingItem) => void;
        settings: LauncherSettingItem[];
        variant: 'dialog' | 'sheet';
      }> = {},
    ) {
      const onOpenSetting = overrides.onOpenSetting ?? vi.fn();
      const result = render(
        <PanelLauncher
          sections={sections}
          badgeCounts={{}}
          pins={[]}
          platform="linux"
          onOpenTab={vi.fn()}
          onTogglePin={vi.fn()}
          onClose={vi.fn()}
          variant={overrides.variant}
          settings={overrides.settings ?? SETTINGS}
          onOpenSetting={onOpenSetting}
        />,
      );
      return { ...result, onOpenSetting };
    }

    const searchInput = () =>
      screen.getByRole('textbox', { name: 'Search panels, contacts, channels and settings' });

    it('is hidden for an empty query and lists matches with their section', async () => {
      const user = userEvent.setup();
      renderWithSettings();
      expect(screen.queryByRole('region', { name: 'Settings' })).toBeNull();
      await user.type(searchInput(), 'offload');
      const group = screen.getByRole('region', { name: 'Settings' });
      const rows = within(group).getAllByRole('button');
      // Prefix matches rank first.
      expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
        'Offload, Contacts',
        'Auto-offload when full, Contact management',
      ]);
    });

    it('opens the highlighted setting with Enter', async () => {
      const user = userEvent.setup();
      const { onOpenSetting } = renderWithSettings();
      await user.type(searchInput(), 'offload{Enter}');
      expect(onOpenSetting).toHaveBeenCalledExactlyOnceWith(SETTINGS[1]);
    });

    it('walks from panel rows into settings rows with the arrow keys and back', async () => {
      const user = userEvent.setup();
      renderWithSettings();
      // "contacts" matches the Contacts panel row and both settings.
      await user.type(searchInput(), 'contacts');
      const panelRow = screen.getByRole('button', { name: 'Contacts' });
      const firstSetting = screen.getByRole('button', {
        name: 'Auto-offload when full, Contact management',
      });
      fireEvent.keyDown(searchInput(), { key: 'ArrowDown' });
      expect(document.activeElement).not.toBe(panelRow);
      expect(firstSetting).toHaveFocus();
      fireEvent.keyDown(firstSetting, { key: 'ArrowUp' });
      expect(panelRow).toHaveFocus();
    });

    it('sends typing on a settings row back to the search field', async () => {
      const user = userEvent.setup();
      renderWithSettings();
      await user.type(searchInput(), 'offload');
      const row = screen.getByRole('button', { name: 'Offload, Contacts' });
      act(() => {
        row.focus();
      });
      fireEvent.keyDown(row, { key: 's' });
      expect(searchInput()).toHaveFocus();
      expect(searchInput()).toHaveValue('offloads');
    });

    it('shows the more-matches hint when the cap is hit', async () => {
      const user = userEvent.setup();
      const many = Array.from({ length: 9 }, (_, i) => ({
        id: `app.test.setting${String(i)}`,
        slot: 'App' as const,
        label: `Toggle ${String(i)}`,
        search: `toggle ${String(i)}`,
      }));
      renderWithSettings({ settings: many });
      await user.type(searchInput(), 'toggle');
      const group = screen.getByRole('region', { name: 'Settings' });
      expect(within(group).getAllByRole('button')).toHaveLength(8);
      expect(within(group).getByText('More match. Keep typing to narrow the list.')).toBeVisible();
    });

    it.each(['dialog', 'sheet'] as const)('renders in the %s variant', async (variant) => {
      const user = userEvent.setup();
      renderWithSettings({ variant });
      await user.type(searchInput(), 'offload');
      expect(screen.getByRole('region', { name: 'Settings' })).toBeInTheDocument();
    });

    it('has no axe violations with settings results', async () => {
      const user = userEvent.setup();
      const { container } = renderWithSettings();
      await user.type(searchInput(), 'offload');
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
