import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { computeTabMappings } from '@/renderer/lib/appTabMappings';
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

    const input = screen.getByRole('textbox', { name: 'Search panels, contacts and channels' });
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
      screen.getByRole('textbox', { name: 'Search panels, contacts and channels' }),
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
      screen.getByRole('textbox', { name: 'Search panels, contacts and channels' }),
    ).toHaveFocus();
  });

  it('filters by label and opens the first match with Enter', async () => {
    const user = userEvent.setup();
    const { props } = renderLauncher();
    await user.type(
      screen.getByRole('textbox', { name: 'Search panels, contacts and channels' }),
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
      screen.getByRole('textbox', { name: 'Search panels, contacts and channels' }),
      'nodes',
    );
    expect(screen.getByRole('button', { name: 'Contacts' })).toBeInTheDocument();
  });

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup();
    renderLauncher();
    await user.type(
      screen.getByRole('textbox', { name: 'Search panels, contacts and channels' }),
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

  it('moves through rows with the arrow keys and back to the search field', () => {
    renderLauncher();
    const input = screen.getByRole('textbox', { name: 'Search panels, contacts and channels' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const firstRow = screen.getByRole('button', { name: 'Chat, 4 unread' });
    expect(firstRow).toHaveFocus();
    fireEvent.keyDown(firstRow, { key: 'ArrowDown' });
    expect(screen.getByRole('button', { name: 'Rooms, 2 unread' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(input).toHaveFocus();
  });

  it('sends typing on a row back to the search field', () => {
    renderLauncher();
    fireEvent.keyDown(
      screen.getByRole('textbox', { name: 'Search panels, contacts and channels' }),
      { key: 'ArrowDown' },
    );
    fireEvent.keyDown(document.activeElement!, { key: 'r' });
    const input = screen.getByRole('textbox', { name: 'Search panels, contacts and channels' });
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
    row.focus();
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
    last?.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(
      screen.getByRole('textbox', { name: 'Search panels, contacts and channels' }),
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
});
