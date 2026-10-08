// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import { UnseenEmergencyBanner } from './UnseenEmergencyBanner';

function ingest(text: string, senderId: string, senderName: string, fromSeed = false) {
  return useIncidentStore.getState().upsertFromMecp({
    protocol: 'meshtastic',
    parsed: tryParseMecp(text)!,
    senderId,
    senderName,
    receivedAt: Date.now(),
    fromSeed,
  })!;
}

describe('UnseenEmergencyBanner', () => {
  beforeEach(() => {
    useIncidentStore.getState().clearAll();
  });

  it('renders nothing without unseen MAYDAY/URGENT incidents', () => {
    ingest('MECP/2/L01 road', '1', 'Safety');
    ingest('MECP/0/D01 M01', '2', 'Drill');
    ingest('MECP/0/M01 seeded', '3', 'Seeded', true);
    const { container } = render(<UnseenEmergencyBanner onView={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the most severe unseen incident and a count of the rest', () => {
    ingest('MECP/1/T04', '1', 'Urgent Ursula');
    ingest('MECP/0/M01 help', '2', 'Mayday Mike');
    render(<UnseenEmergencyBanner onView={vi.fn()} />);
    const alert = screen.getByRole('alert', { name: 'Unseen emergency alert' });
    expect(alert).toHaveTextContent('Emergency from Mayday Mike');
    expect(alert).toHaveTextContent('+1 more unseen');
  });

  it('Mark seen advances to the next incident, then hides', async () => {
    const user = userEvent.setup();
    ingest('MECP/1/T04', '1', 'Urgent Ursula');
    ingest('MECP/0/M01 help', '2', 'Mayday Mike');
    render(<UnseenEmergencyBanner onView={vi.fn()} />);
    await user.click(
      screen.getByRole('button', { name: 'Mark the emergency from Mayday Mike as seen' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Emergency from Urgent Ursula');
    await user.click(
      screen.getByRole('button', { name: 'Mark the emergency from Urgent Ursula as seen' }),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('View calls onView; resolving elsewhere clears the banner', async () => {
    const user = userEvent.setup();
    const onView = vi.fn();
    const id = ingest('MECP/0/M01 help', '2', 'Mayday Mike');
    render(<UnseenEmergencyBanner onView={onView} />);
    await user.click(screen.getByRole('button', { name: 'Open the Incident tab' }));
    expect(onView).toHaveBeenCalledOnce();
    act(() => {
      useIncidentStore.getState().resolveIncident(id);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['MECP/0/M01 help', 'MECP/1/T04'])('has no axe violations (%s)', async (text) => {
    ingest(text, '2', 'Mayday Mike');
    const { container } = render(<UnseenEmergencyBanner onView={vi.fn()} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
