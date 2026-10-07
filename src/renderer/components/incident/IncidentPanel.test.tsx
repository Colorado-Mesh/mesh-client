// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import IncidentPanel from './IncidentPanel';

const { downloadBlobMock } = vi.hoisted(() => ({ downloadBlobMock: vi.fn() }));
vi.mock('@/renderer/lib/downloadBlob', () => ({ downloadBlob: downloadBlobMock }));

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
    downloadBlobMock.mockClear();
  });

  it('disables the incident log export when there are no incidents', () => {
    render(<IncidentPanel />);
    expect(screen.getByRole('button', { name: /incidentPanel\.exportLog/ })).toBeDisabled();
  });

  it('exports resolved incidents too, as JSON and CSV', async () => {
    const user = userEvent.setup();
    const openId = ingest('MECP/0/M01 help', '7', 'Open');
    const closedId = ingest('MECP/2/L01 road', '8', 'Closed');
    useIncidentStore.getState().resolveIncident(closedId);
    render(<IncidentPanel />);

    await user.click(screen.getByRole('button', { name: /incidentPanel\.exportLog/ }));
    await user.click(screen.getByRole('menuitem', { name: 'incidentPanel.exportJson' }));
    const [jsonBlob, jsonName] = downloadBlobMock.mock.calls[0] as [Blob, string];
    expect(jsonName).toMatch(/^mesh-incidents-\d{4}-\d{2}-\d{2}\.json$/);
    const payload = JSON.parse(await jsonBlob.text()) as {
      format: string;
      incidents: { id: string; status: string }[];
    };
    expect(payload.format).toBe('mesh-client-incidents');
    expect(payload.incidents.map((i) => [i.id, i.status]).sort()).toEqual(
      [
        [openId, 'open'],
        [closedId, 'resolved'],
      ].sort(),
    );

    await user.click(screen.getByRole('button', { name: /incidentPanel\.exportLog/ }));
    await user.click(screen.getByRole('menuitem', { name: 'incidentPanel.exportCsv' }));
    const [csvBlob, csvName] = downloadBlobMock.mock.calls[1] as [Blob, string];
    expect(csvName).toMatch(/\.csv$/);
    expect((await csvBlob.text()).trimEnd().split('\r\n')).toHaveLength(3);
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
