import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { computeTabMappings } from '@/renderer/lib/appTabMappings';
import { computeNavSections } from '@/renderer/lib/navSections';
import { MESHCORE_CAPABILITIES } from '@/renderer/lib/radio/BaseRadioProvider';

import { AppRail } from './AppRail';

const identityT = ((key: string) => key) as TFunction;
const meshcoreSections = computeNavSections(
  computeTabMappings(identityT, 'meshcore', MESHCORE_CAPABILITIES),
  MESHCORE_CAPABILITIES,
);

describe('AppRail', () => {
  it('lists the five sections, then Incident and App', () => {
    render(
      <AppRail
        sections={meshcoreSections}
        activeSectionId="chat"
        badgeCounts={{}}
        onSectionSelect={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Application panels' });
    const names = Array.from(nav.querySelectorAll('button')).map((b) => b.getAttribute('title'));
    expect(names).toEqual(['Chat', 'Network', 'Map', 'Monitor', 'Device', 'Incident', 'App']);
  });

  it('keeps Incident and App outside the scrolling part of the rail (EMCOMM S9)', () => {
    render(
      <AppRail
        header={<div>switcher</div>}
        sections={meshcoreSections}
        activeSectionId="chat"
        badgeCounts={{ Incident: 1 }}
        onSectionSelect={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Application panels' });
    const scroll = nav.querySelector('[data-rail-scroll]');
    const footer = nav.querySelector('[data-rail-footer]');
    expect(scroll?.className).toContain('overflow-y-auto');
    expect(footer?.className).toContain('shrink-0');
    expect(footer?.className).not.toContain('overflow');
    const footerTitles = Array.from(footer?.querySelectorAll('button') ?? []).map((b) =>
      b.getAttribute('title'),
    );
    expect(footerTitles).toEqual(['Incident', 'App']);
    expect(scroll?.querySelector('[data-nav-section="incident"]')).toBeNull();
  });

  it('marks the active section with aria-current', () => {
    render(
      <AppRail
        sections={meshcoreSections}
        activeSectionId="device"
        badgeCounts={{}}
        onSectionSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Device' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: 'Chat' })).not.toHaveAttribute('aria-current');
  });

  it('calls onSectionSelect with the section id', async () => {
    const user = userEvent.setup();
    const onSectionSelect = vi.fn();
    render(
      <AppRail
        sections={meshcoreSections}
        activeSectionId="chat"
        badgeCounts={{}}
        onSectionSelect={onSectionSelect}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Monitor' }));
    expect(onSectionSelect).toHaveBeenCalledWith('monitor');
  });

  it('sums Chat and Rooms unread into the Chat section badge', () => {
    render(
      <AppRail
        sections={meshcoreSections}
        activeSectionId="device"
        badgeCounts={{ Chat: 4, Rooms: 2 }}
        onSectionSelect={vi.fn()}
      />,
    );
    const chat = screen.getByRole('button', { name: 'Chat, 6 unread' });
    expect(chat).toHaveTextContent('6');
    expect(chat.querySelector('.bg-red-600')).not.toBeNull();
  });

  it('shows the Incident badge with the open-incident label', () => {
    render(
      <AppRail
        sections={meshcoreSections}
        activeSectionId="chat"
        badgeCounts={{ Incident: 2 }}
        onSectionSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Incident, 2 open MAYDAY or URGENT incidents' }),
    ).toBeInTheDocument();
  });

  it('caps section badges at 99+', () => {
    render(
      <AppRail
        sections={meshcoreSections}
        activeSectionId="device"
        badgeCounts={{ Chat: 150 }}
        onSectionSelect={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Chat, 99+ unread' })).toHaveTextContent('99+');
  });

  it('renders the header slot above the sections', () => {
    render(
      <AppRail
        header={<div data-testid="rail-header" />}
        sections={meshcoreSections}
        activeSectionId="chat"
        badgeCounts={{}}
        onSectionSelect={vi.fn()}
      />,
    );
    const nav = screen.getByRole('navigation', { name: 'Application panels' });
    const scroll = nav.querySelector('[data-rail-scroll]');
    expect(scroll?.firstElementChild).toBe(screen.getByTestId('rail-header'));
  });

  describe('pinned panels', () => {
    const pins = [
      { tabIndex: 1, iconSlot: 'Chat' as const, label: 'Chat', shortcut: 'Ctrl+1' },
      { tabIndex: 3, iconSlot: 'Map' as const, label: 'Map', shortcut: 'Ctrl+3' },
    ];

    it('shows launcher pins after the sections with their shortcut in the tooltip', () => {
      render(
        <AppRail
          sections={meshcoreSections}
          activeSectionId="chat"
          badgeCounts={{}}
          onSectionSelect={vi.fn()}
          pins={pins}
          activeTabIndex={3}
        />,
      );
      const nav = screen.getByRole('navigation', { name: 'Application panels' });
      const scroll = nav.querySelector('[data-rail-scroll]');
      const pinButtons = Array.from(scroll?.querySelectorAll('[data-rail-pin]') ?? []);
      expect(pinButtons.map((b) => b.getAttribute('title'))).toEqual([
        'Chat (Ctrl+1)',
        'Map (Ctrl+3)',
      ]);
      expect(pinButtons[1]).toHaveClass('text-bright-green');
      expect(pinButtons[0]).not.toHaveClass('text-bright-green');
    });

    it('marks the active pin with aria-current', () => {
      render(
        <AppRail
          sections={meshcoreSections}
          activeSectionId="chat"
          badgeCounts={{}}
          onSectionSelect={vi.fn()}
          pins={pins}
          activeTabIndex={3}
        />,
      );
      expect(screen.getByRole('button', { name: 'Map (Ctrl+3)' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByRole('button', { name: 'Chat (Ctrl+1)' })).not.toHaveAttribute(
        'aria-current',
      );
    });

    it('opens the pinned panel on click', async () => {
      const user = userEvent.setup();
      const onPinSelect = vi.fn();
      render(
        <AppRail
          sections={meshcoreSections}
          activeSectionId="chat"
          badgeCounts={{}}
          onSectionSelect={vi.fn()}
          pins={pins}
          onPinSelect={onPinSelect}
        />,
      );
      // The shortcut in the name keeps the pin distinct from the Map section button.
      await user.click(screen.getByRole('button', { name: 'Map (Ctrl+3)' }));
      expect(onPinSelect).toHaveBeenCalledWith(3);
    });

    it('renders nothing extra when no pin is visible', () => {
      render(
        <AppRail
          sections={meshcoreSections}
          activeSectionId="chat"
          badgeCounts={{}}
          onSectionSelect={vi.fn()}
        />,
      );
      expect(document.querySelector('[data-rail-pin]')).toBeNull();
    });

    it('has no axe violations with pins', async () => {
      const { container } = render(
        <AppRail
          sections={meshcoreSections}
          activeSectionId="chat"
          badgeCounts={{}}
          onSectionSelect={vi.fn()}
          pins={pins}
          activeTabIndex={1}
        />,
      );
      hydrateAxeThemeColors(container);
      expect(await axe(container)).toHaveNoViolations();
    });
  });
});
