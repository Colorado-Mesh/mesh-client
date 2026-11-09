import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { MemberPresenceSnapshot } from '@/renderer/lib/teamRoster/contactPresence';
import type { TeamMember } from '@/shared/teamRosterTypes';

import { TeamContactDetailDialog } from './TeamContactDetailDialog';

const member: TeamMember = {
  unitId: 3,
  callsign: 'Charlie',
  role: 'GATE',
  color: '#38BDF8',
  isSelf: false,
  onRoster: true,
  createdAt: 1,
  updatedAt: 1,
  links: [
    { protocol: 'meshtastic', durableKey: '10', nodeId: 10, longName: 'C-MT' },
    { protocol: 'meshcore', durableKey: '20', nodeId: 20, longName: 'C-MC' },
  ],
};

const meshtasticLink = member.links[0];
const meshcoreLink = member.links[1];

const presence: MemberPresenceSnapshot = {
  unitId: 3,
  aggregateStatus: 'online',
  lastActive: {
    link: meshcoreLink,
    peerNodeId: 20,
    lastHeardMs: 200,
    status: 'online',
    displayName: 'C-MC',
  },
  links: [
    {
      link: meshtasticLink,
      peerNodeId: 10,
      lastHeardMs: 50,
      status: 'stale',
      displayName: 'C-MT',
    },
    {
      link: meshcoreLink,
      peerNodeId: 20,
      lastHeardMs: 200,
      status: 'online',
      displayName: 'C-MC',
    },
  ],
};

describe('TeamContactDetailDialog', () => {
  it('defaults compose picker to last-active protocol and sends that link', async () => {
    const user = userEvent.setup();
    const onSendDm = vi.fn().mockReturnValue(true);
    render(
      <TeamContactDetailDialog
        member={member}
        presence={presence}
        messagesByProtocol={{
          meshtastic: [
            {
              sender_id: 10,
              sender_name: 'C-MT',
              payload: 'hello',
              timestamp: 1,
              channel: 0,
              to: 1,
            },
          ],
          meshcore: [],
          reticulum: [],
        }}
        onClose={() => {}}
        onOpenChat={() => {}}
        onSendDm={onSendDm}
      />,
    );

    expect(screen.getByLabelText(/send via/i)).toHaveValue('meshcore:20');
    expect(screen.getByText(/hello/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/message body/i), 'Check-in');
    await user.click(screen.getByRole('button', { name: /^send$/i }));
    expect(onSendDm).toHaveBeenCalledWith({
      protocol: 'meshcore',
      destination: 20,
      reticulumHash: null,
      text: 'Check-in',
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <TeamContactDetailDialog
        member={member}
        presence={presence}
        messagesByProtocol={{ meshtastic: [], meshcore: [], reticulum: [] }}
        onClose={() => {}}
        onOpenChat={() => {}}
        onSendDm={() => true}
      />,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
