import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

import RrcPanel from './RrcPanel';

vi.mock('@/renderer/lib/reticulum/reticulumSidecarReads', () => ({
  isReticulumSidecarRunning: vi.fn(() => Promise.resolve(false)),
}));

describe('RrcPanel', () => {
  beforeEach(() => {
    useRrcSessionStore.getState().clearSession();
    useRrcHubStore.setState({ hubs: new Map() });
    hydrateAxeThemeColors(document.documentElement);
  });

  it('renders amber hub chrome and select-hub prompt', async () => {
    const { container } = render(<RrcPanel isActive />);
    expect(screen.getAllByText(/Select an RRC hub/i).length).toBeGreaterThan(0);
    expect(container.querySelector('[class*="border-amber"]')).toBeTruthy();
    expect(await axe(container)).toHaveNoViolations();
  });
});
