import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { computeTabMappings } from '@/renderer/lib/appTabMappings';
import { computeNavSections } from '@/renderer/lib/navSections';
import {
  MESHCORE_CAPABILITIES,
  RETICULUM_CAPABILITIES,
} from '@/renderer/lib/radio/BaseRadioProvider';

import { AppRail } from './AppRail';

const identityT = ((key: string) => key) as TFunction;
const meshcoreSections = computeNavSections(
  computeTabMappings(identityT, 'meshcore', MESHCORE_CAPABILITIES),
  MESHCORE_CAPABILITIES,
);
const reticulumSections = computeNavSections(
  computeTabMappings(identityT, 'reticulum', RETICULUM_CAPABILITIES),
  RETICULUM_CAPABILITIES,
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

  it('shows Reticulum pending file offers on Network in amber', () => {
    render(
      <AppRail
        sections={reticulumSections}
        activeSectionId="chat"
        badgeCounts={{ Remote: 3 }}
        onSectionSelect={vi.fn()}
      />,
    );
    const network = screen.getByRole('button', {
      name: /^Network, 3 pending inbound file offers$/,
    });
    expect(network.querySelector('.bg-amber-800')).not.toBeNull();
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
    expect(nav.firstElementChild).toBe(screen.getByTestId('rail-header'));
  });

  it('has no axe violations with badges', async () => {
    const { container } = render(
      <AppRail
        sections={reticulumSections}
        activeSectionId="chat"
        badgeCounts={{ Chat: 12, Remote: 1, Incident: 1 }}
        onSectionSelect={vi.fn()}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
