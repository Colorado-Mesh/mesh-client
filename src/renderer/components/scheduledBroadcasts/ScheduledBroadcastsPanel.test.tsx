import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetScheduledBroadcastsStoreForTests,
  useScheduledBroadcastsStore,
} from '@/renderer/stores/scheduledBroadcastsStore';

import ScheduledBroadcastsPanel from './ScheduledBroadcastsPanel';

beforeEach(() => {
  resetScheduledBroadcastsStoreForTests();
  useScheduledBroadcastsStore.setState({ hydrated: true });
});

describe('ScheduledBroadcastsPanel', () => {
  it('renders 12 slots', () => {
    render(<ScheduledBroadcastsPanel />);
    expect(screen.getAllByText(/^B\d+$/).length).toBe(12);
  });

  it('shows a respect warning against channel spam', () => {
    render(<ScheduledBroadcastsPanel />);
    expect(screen.getByText(/be respectful of shared lora airtime/i)).toBeInTheDocument();
  });

  it('opens editor from Add', async () => {
    const user = userEvent.setup();
    render(<ScheduledBroadcastsPanel />);
    await user.click(screen.getAllByRole('button', { name: /add broadcast/i })[0]);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<ScheduledBroadcastsPanel />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
