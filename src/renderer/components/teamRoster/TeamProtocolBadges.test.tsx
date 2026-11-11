import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { TeamMemberLink } from '@/shared/teamRosterTypes';

import { TeamProtocolBadges } from './TeamProtocolBadges';

function link(overrides: Partial<TeamMemberLink>): TeamMemberLink {
  return { protocol: 'meshtastic', durableKey: '1', onRoster: true, ...overrides };
}

describe('TeamProtocolBadges', () => {
  it('shows the empty placeholder when no links exist', () => {
    render(<TeamProtocolBadges links={[]} />);
    expect(screen.getByText('No linked nodes')).toBeInTheDocument();
  });

  it('renders one badge per linked protocol and covers all three protocols', () => {
    render(
      <TeamProtocolBadges
        links={[
          link({ protocol: 'meshtastic', durableKey: '101' }),
          link({ protocol: 'meshcore', durableKey: 'ab'.repeat(32) }),
          link({ protocol: 'reticulum', durableKey: 'cd'.repeat(16) }),
        ]}
      />,
    );
    expect(screen.getByLabelText('Linked protocols')).toBeInTheDocument();
    expect(screen.getByText('Meshtastic')).toBeInTheDocument();
    expect(screen.getByText('MeshCore')).toBeInTheDocument();
    expect(screen.getByText('Reticulum')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('uses the long name as the badge title and falls back to the durable key', () => {
    render(
      <TeamProtocolBadges
        links={[
          link({ durableKey: '101', longName: 'N0CALL' }),
          link({ protocol: 'meshcore', durableKey: 'MC-KEY' }),
        ]}
      />,
    );
    expect(screen.getByText('Meshtastic')).toHaveAttribute('title', 'N0CALL');
    expect(screen.getByText('MeshCore')).toHaveAttribute('title', 'MC-KEY');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <div className="bg-ink-900">
        <TeamProtocolBadges
          links={[
            link({ protocol: 'meshtastic', durableKey: '101' }),
            link({ protocol: 'meshcore', durableKey: 'mc' }),
            link({ protocol: 'reticulum', durableKey: 'rn' }),
          ]}
        />
      </div>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
