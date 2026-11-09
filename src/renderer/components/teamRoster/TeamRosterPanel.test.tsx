import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  resetTeamRosterStoreForTests,
  useTeamRosterStore,
} from '@/renderer/stores/teamRosterStore';

import TeamRosterPanel from './TeamRosterPanel';

beforeEach(() => {
  resetTeamRosterStoreForTests();
  useTeamRosterStore.setState({
    hydrated: true,
    members: [
      {
        unitId: 7,
        callsign: 'Golf',
        role: 'MEDIC',
        color: null,
        isSelf: false,
        createdAt: 1,
        updatedAt: 1,
        links: [],
      },
    ],
  });
});

describe('TeamRosterPanel', () => {
  it('renders the roster table', () => {
    render(<TeamRosterPanel />);
    expect(screen.getByRole('columnheader', { name: /unit id/i })).toBeInTheDocument();
    expect(screen.getByText('Golf')).toBeInTheDocument();
    expect(screen.getByText('MEDIC')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(<TeamRosterPanel />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
