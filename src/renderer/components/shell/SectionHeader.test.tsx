import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { computeTabMappings } from '@/renderer/lib/appTabMappings';
import { computeNavSections, type NavSectionId } from '@/renderer/lib/navSections';
import { MESHCORE_CAPABILITIES } from '@/renderer/lib/radio/BaseRadioProvider';

import { SectionHeader } from './SectionHeader';

const labelT = ((key: string) =>
  ({
    'tabs.chat': 'Chat',
    'tabs.rooms': 'Rooms',
    'tabs.diagnostics': 'Diagnostics',
    'tabs.telemetry': 'Telemetry',
    'tabs.stats': 'Stats',
    'tabs.sniffer': 'Sniffer',
    'tabs.rf': 'RF',
    'tabs.map': 'Map',
  })[key] ?? key) as TFunction;

const sections = computeNavSections(
  computeTabMappings(labelT, 'meshcore', MESHCORE_CAPABILITIES),
  MESHCORE_CAPABILITIES,
);

function sectionById(id: NavSectionId) {
  const found = sections.find((s) => s.id === id);
  if (!found) throw new Error(`missing section ${id}`);
  return found;
}

describe('SectionHeader', () => {
  it('renders the section panels as tabs wired to their tabpanels', () => {
    const monitor = sectionById('monitor');
    const sniffer = monitor.tabs.find((tab) => tab.slot === 'Sniffer');
    render(
      <SectionHeader
        section={monitor}
        sectionLabel="Monitor"
        activeTabIndex={sniffer?.tabIndex ?? -1}
        badgeCounts={{}}
        onTabSelect={vi.fn()}
      />,
    );
    const tablist = screen.getByRole('tablist', { name: 'Monitor panels' });
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Diagnostics', 'Stats', 'Sniffer', 'RF']);
    const snifferTab = screen.getByRole('tab', { name: 'Sniffer' });
    expect(snifferTab).toHaveAttribute('aria-selected', 'true');
    expect(snifferTab).toHaveAttribute('id', `tab-${sniffer?.tabIndex}`);
    expect(snifferTab).toHaveAttribute('aria-controls', `panel-${sniffer?.panelIndex}`);
    expect(snifferTab).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Stats' })).toHaveAttribute('tabindex', '-1');
  });

  it('selects a tab on click', async () => {
    const user = userEvent.setup();
    const onTabSelect = vi.fn();
    const monitor = sectionById('monitor');
    render(
      <SectionHeader
        section={monitor}
        sectionLabel="Monitor"
        activeTabIndex={monitor.tabs[0]?.tabIndex ?? -1}
        badgeCounts={{}}
        onTabSelect={onTabSelect}
      />,
    );
    await user.click(screen.getByRole('tab', { name: 'RF' }));
    expect(onTabSelect).toHaveBeenCalledWith(monitor.tabs[3]?.tabIndex);
  });

  it('moves between tabs with arrow keys, Home and End', () => {
    const onTabSelect = vi.fn();
    const monitor = sectionById('monitor');
    render(
      <SectionHeader
        section={monitor}
        sectionLabel="Monitor"
        activeTabIndex={monitor.tabs[0]?.tabIndex ?? -1}
        badgeCounts={{}}
        onTabSelect={onTabSelect}
      />,
    );
    const first = screen.getByRole('tab', { name: 'Diagnostics' });
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(onTabSelect).toHaveBeenLastCalledWith(monitor.tabs[1]?.tabIndex);
    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(onTabSelect).toHaveBeenLastCalledWith(monitor.tabs[3]?.tabIndex);
    fireEvent.keyDown(first, { key: 'End' });
    expect(onTabSelect).toHaveBeenLastCalledWith(monitor.tabs[3]?.tabIndex);
    fireEvent.keyDown(first, { key: 'Home' });
    expect(onTabSelect).toHaveBeenLastCalledWith(monitor.tabs[0]?.tabIndex);
  });

  it('shows unread badges on sub-tabs', () => {
    const chat = sectionById('chat');
    render(
      <SectionHeader
        section={chat}
        sectionLabel="Chat"
        activeTabIndex={chat.tabs[0]?.tabIndex ?? -1}
        badgeCounts={{ Rooms: 2 }}
        onTabSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Rooms, 2 unread' })).toHaveTextContent('Rooms2');
    expect(screen.getByRole('tab', { name: 'Chat' })).toBeInTheDocument();
  });

  it('labels a single-panel section panel with the section title', () => {
    const map = sectionById('map');
    render(
      <SectionHeader
        section={map}
        sectionLabel="Map"
        activeTabIndex={map.tabs[0]?.tabIndex ?? -1}
        badgeCounts={{}}
        onTabSelect={vi.fn()}
      />,
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Map' })).toHaveAttribute(
      'id',
      `tab-${map.tabs[0]?.tabIndex}`,
    );
  });

  it('renders the actions slot', () => {
    render(
      <SectionHeader
        section={sectionById('map')}
        sectionLabel="Map"
        activeTabIndex={0}
        badgeCounts={{}}
        onTabSelect={vi.fn()}
        actions={<button type="button">Search</button>}
      />,
    );
    expect(screen.getByRole('banner')).toContainElement(
      screen.getByRole('button', { name: 'Search' }),
    );
  });

  it('has no axe violations with a badge', async () => {
    const chat = sectionById('chat');
    const { container } = render(
      <>
        <SectionHeader
          section={chat}
          sectionLabel="Chat"
          activeTabIndex={chat.tabs[0]?.tabIndex ?? -1}
          badgeCounts={{ Chat: 3, Rooms: 120 }}
          onTabSelect={vi.fn()}
        />
        {/* aria-controls must point at real tabpanels, as App renders them. */}
        {chat.tabs.map((tab, i) => (
          <div
            key={tab.panelIndex}
            id={`panel-${tab.panelIndex}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab.tabIndex}`}
            hidden={i !== 0}
          />
        ))}
      </>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
