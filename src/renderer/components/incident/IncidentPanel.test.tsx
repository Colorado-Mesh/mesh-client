// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import IncidentPanel from './IncidentPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && Object.keys(opts).length > 0 ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

function ingest(text: string, senderId: string, senderName: string) {
  return useIncidentStore.getState().upsertFromMecp({
    protocol: 'meshtastic',
    parsed: tryParseMecp(text)!,
    senderId,
    senderName,
    receivedAt: 1_000,
  })!;
}

describe('IncidentPanel', () => {
  beforeEach(() => {
    useIncidentStore.getState().clearAll();
  });

  it('shows the empty state with no axe violations', async () => {
    const { container } = render(<IncidentPanel />);
    expect(screen.getByText('incidentPanel.intro')).toBeInTheDocument();
    expect(screen.getByText('incidentPanel.empty')).toBeInTheDocument();
    expect(screen.getByText('incidentPanel.emptyHint')).toBeInTheDocument();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lists open incidents severity-sorted and resolves on click', async () => {
    const user = userEvent.setup();
    ingest('MECP/3/L01 lunch', '!r', 'Routine');
    ingest('MECP/0/B01 M01', '!m', 'Mayday');
    const onAck = vi.fn();
    const { container } = render(<IncidentPanel onAck={onAck} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Mayday');
    expect(items[1]).toHaveTextContent('Routine');
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    await user.click(
      screen.getByRole('button', { name: 'incidentPanel.ackBeaconAria:{"sender":"Mayday"}' }),
    );
    expect(onAck).toHaveBeenCalledWith(expect.objectContaining({ senderName: 'Mayday' }));

    await user.click(
      screen.getByRole('button', { name: 'incidentPanel.resolveAria:{"sender":"Routine"}' }),
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('labels an originated beacon as Cancel beacon and leaves other beacons as Resolve', async () => {
    const user = userEvent.setup();
    ingest('MECP/0/B01 M01', '42', 'Ada');
    ingest('MECP/0/B01', '99', 'Other');
    const onResolve = vi.fn();
    render(<IncidentPanel onResolve={onResolve} ownSenderIds={new Set(['42'])} />);

    await user.click(
      screen.getByRole('button', { name: 'incidentPanel.resolveBeaconAria:{"sender":"Ada"}' }),
    );
    expect(onResolve).toHaveBeenCalledWith(
      expect.objectContaining({ senderId: '42', beaconActive: true }),
    );
    expect(
      screen.getByRole('button', { name: 'incidentPanel.resolveAria:{"sender":"Other"}' }),
    ).toBeInTheDocument();
  });
});
