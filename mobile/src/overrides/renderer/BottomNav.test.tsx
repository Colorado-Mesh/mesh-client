import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { BottomNav } from '@/renderer/components/shell/BottomNav';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { NavSection } from '@/renderer/lib/navSections';

import {
  computeMobileViewport,
  DESKTOP_VIEWPORT,
  setMobileViewport,
} from '../../platform/mobileViewport';

const SECTIONS = [
  { id: 'chat', tabs: [] },
  { id: 'network', tabs: [] },
  { id: 'map', tabs: [] },
  { id: 'radio', tabs: [] },
] as unknown as NavSection[];

function renderNav(onSectionSelect = vi.fn()) {
  return render(
    <BottomNav
      sections={SECTIONS}
      activeSectionId="chat"
      badgeCounts={{}}
      onSectionSelect={onSectionSelect}
      moreOpen={false}
      onMore={vi.fn()}
    />,
  );
}

function duoFolded() {
  setMobileViewport(
    computeMobileViewport({
      usableWidth: 382,
      usableHeight: 657,
      fold: null,
      posture: 'flat',
      keyboardOpen: false,
      keyboardInset: 0,
      previousPanes: null,
      sideColumn: {
        viewportWidth: 466,
        viewportHeight: 678,
        insets: { top: 0, right: 84, bottom: 21, left: 0 },
        occlusions: [{ left: 396, top: 10, right: 456, bottom: 120 }],
      },
    }),
  );
}

afterEach(() => {
  setMobileViewport(DESKTOP_VIEWPORT);
});

describe('BottomNav (mobile override)', () => {
  it('renders the unchanged bar without a side column', () => {
    const { container } = renderNav();
    expect(container.querySelector('[data-mobile-side-nav]')).toBeNull();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('stands the same bar in the iPhone Duo side column', () => {
    duoFolded();
    const onSectionSelect = vi.fn();
    const { container } = renderNav(onSectionSelect);
    const column = container.querySelector('[data-mobile-side-nav]');
    expect(column?.getAttribute('data-mobile-side-nav')).toBe('right');
    const nav = screen.getByRole('navigation');
    expect(column?.contains(nav)).toBe(true);
    // Same items and behaviour as the bar: sections in order, then More.
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('data-nav-section'))).toEqual([
      'chat',
      'network',
      'map',
      'more',
    ]);
    fireEvent.click(buttons[1]);
    expect(onSectionSelect).toHaveBeenCalledWith('network');
  });

  it('has no axe violations in the side column', async () => {
    duoFolded();
    const { container } = renderNav();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
