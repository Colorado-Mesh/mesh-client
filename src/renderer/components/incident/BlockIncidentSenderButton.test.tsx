// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import { useIncidentStore } from '@/renderer/stores/incidentStore';
import { isMecpSenderBlocked, useMecpBlockStore } from '@/renderer/stores/mecpBlockStore';

import { EmergencyIncidentRow } from './EmergencyIncidentRow';

function ingest(text: string, senderId: string, senderName: string, localOrigin = false) {
  const id = useIncidentStore.getState().upsertFromMecp({
    protocol: 'meshtastic',
    parsed: tryParseMecp(text)!,
    senderId,
    senderName,
    receivedAt: Date.now(),
    ...(localOrigin ? { localOrigin: true } : {}),
  })!;
  return useIncidentStore.getState().incidents[id];
}

describe('BlockIncidentSenderButton (in EmergencyIncidentRow)', () => {
  beforeEach(() => {
    useIncidentStore.getState().clearAll();
    useMecpBlockStore.setState({ blocked: {} });
  });

  it('asks first, then "Block only" blocks without resolving', async () => {
    const user = userEvent.setup();
    const inc = ingest('MECP/0/M01 fake', '9', 'Spammer');
    render(
      <ul>
        <EmergencyIncidentRow incident={inc} />
      </ul>,
    );
    await user.click(screen.getByRole('button', { name: 'Block emergency alerts from Spammer' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Node IDs can be spoofed');
    expect(isMecpSenderBlocked('meshtastic', '9')).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Block only' }));
    expect(isMecpSenderBlocked('meshtastic', '9')).toBe(true);
    expect(useIncidentStore.getState().incidents[inc.id]?.status).toBe('open');
  });

  it('"Block and resolve" also resolves the sender\'s open incidents', async () => {
    const user = userEvent.setup();
    const inc = ingest('MECP/0/M01 fake', '9', 'Spammer');
    render(
      <ul>
        <EmergencyIncidentRow incident={inc} />
      </ul>,
    );
    await user.click(screen.getByRole('button', { name: 'Block emergency alerts from Spammer' }));
    await user.click(screen.getByRole('button', { name: 'Block and resolve' }));
    expect(isMecpSenderBlocked('meshtastic', '9')).toBe(true);
    expect(useIncidentStore.getState().incidents[inc.id]?.status).toBe('resolved');
  });

  it('cancel leaves the sender unblocked', async () => {
    const user = userEvent.setup();
    const inc = ingest('MECP/0/M01 fake', '9', 'Spammer');
    render(
      <ul>
        <EmergencyIncidentRow incident={inc} />
      </ul>,
    );
    await user.click(screen.getByRole('button', { name: 'Block emergency alerts from Spammer' }));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(isMecpSenderBlocked('meshtastic', '9')).toBe(false);
  });

  it("is hidden on the operator's own beacon", () => {
    const inc = ingest('MECP/0/B01 M01', '1', 'Me', true);
    render(
      <ul>
        <EmergencyIncidentRow incident={inc} />
      </ul>,
    );
    expect(screen.queryByRole('button', { name: /Block emergency alerts/ })).toBeNull();
  });

  it('has no axe violations', async () => {
    const inc = ingest('MECP/0/M01 fake', '9', 'Spammer');
    const { container } = render(
      <ul>
        <EmergencyIncidentRow incident={inc} />
      </ul>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
