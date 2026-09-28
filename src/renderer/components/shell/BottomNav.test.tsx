import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TFunction } from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { computeTabMappings } from '@/renderer/lib/appTabMappings';
import { computeNavSections } from '@/renderer/lib/navSections';
import { MESHCORE_CAPABILITIES } from '@/renderer/lib/radio/BaseRadioProvider';

import { BottomNav } from './BottomNav';

const identityT = ((key: string) => key) as TFunction;
const sections = computeNavSections(
  computeTabMappings(identityT, 'meshcore', MESHCORE_CAPABILITIES),
  MESHCORE_CAPABILITIES,
);

function renderNav(props: Partial<Parameters<typeof BottomNav>[0]> = {}) {
  const onSectionSelect = vi.fn();
  const onMore = vi.fn();
  const utils = render(
    <BottomNav
      sections={sections}
      activeSectionId="chat"
      badgeCounts={{}}
      onSectionSelect={onSectionSelect}
      moreOpen={false}
      onMore={onMore}
      {...props}
    />,
  );
  const nav = screen.getByRole('navigation', { name: 'Application panels' });
  return { ...utils, nav, onSectionSelect, onMore };
}

describe('BottomNav', () => {
  it('shows Chat, Network, Map and Incident, then More', () => {
    const { nav } = renderNav();
    expect(
      within(nav)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Chat', 'Network', 'Map', 'Incident', 'More']);
    expect(within(nav).getByRole('button', { name: 'Chat' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps the Incident badge on the bar and sums hidden sections into More', () => {
    const { nav } = renderNav({ badgeCounts: { Incident: 2, Diagnostics: 3, Chat: 1 } });
    expect(
      within(nav).getByRole('button', {
        name: 'Incident, 2 open MAYDAY or URGENT incidents',
      }),
    ).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /^More/ })).toHaveTextContent('3');
  });

  it('selects sections and opens More', async () => {
    const user = userEvent.setup();
    const { nav, onSectionSelect, onMore } = renderNav();
    await user.click(within(nav).getByRole('button', { name: 'Map' }));
    expect(onSectionSelect).toHaveBeenCalledWith('map');
    const more = within(nav).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    expect(more).toHaveAttribute('aria-expanded', 'false');
    await user.click(more);
    expect(onMore).toHaveBeenCalled();
  });

  it('marks More active while a section under it is open', () => {
    const { nav } = renderNav({ activeSectionId: 'device' });
    const more = within(nav).getByRole('button', { name: 'More' });
    expect(more.className).toContain('text-bright-green');
    expect(more).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Chat' })).not.toHaveAttribute('aria-current');
  });

  it('does not mark More current when it is only open over a primary section', () => {
    const { nav } = renderNav({ activeSectionId: 'chat', moreOpen: true });
    const more = within(nav).getByRole('button', { name: 'More' });
    expect(more.className).toContain('text-bright-green');
    expect(more).not.toHaveAttribute('aria-current');
    expect(within(nav).getByRole('button', { name: 'Chat' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('has no axe violations with badges', async () => {
    const { container } = renderNav({ badgeCounts: { Chat: 12, Incident: 1, Diagnostics: 1 } });
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
