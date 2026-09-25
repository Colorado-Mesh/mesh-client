// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmergencyIncident } from '@/renderer/lib/mecp/incidentTypes';
import { useIncidentStore } from '@/renderer/stores/incidentStore';

import {
  incidentMarkersFrom,
  IncidentMarkersLayer,
  MeasureControl,
  MgrsGridLayer,
} from './emcommMapLayers';

type Handler = (e: unknown) => void;
const handlers = new Map<string, Handler>();
const mockMap = {
  on: vi.fn((ev: string, fn: Handler) => handlers.set(ev, fn)),
  off: vi.fn((ev: string) => handlers.delete(ev)),
  whenReady: vi.fn((fn: () => void) => {
    fn();
  }),
  getBounds: vi.fn(() => ({
    getSouth: () => 39.7,
    getWest: () => -105.0,
    getNorth: () => 39.8,
    getEast: () => -104.9,
  })),
};

vi.mock('react-leaflet', () => ({
  useMap: () => mockMap,
  CircleMarker: ({ children, center }: { children?: ReactNode; center: [number, number] }) => (
    <div data-testid="circle" data-center={center.join(',')}>
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Rectangle: ({ children }: { children?: ReactNode }) => <div data-testid="rect">{children}</div>,
  Polyline: () => <div data-testid="polyline" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

function incident(over: Partial<EmergencyIncident>): EmergencyIncident {
  return {
    id: 'i1',
    protocol: 'meshtastic',
    protocolsSeen: ['meshtastic'],
    severity: 0,
    codes: ['A01'],
    freetext: '',
    senderId: '!1',
    senderName: 'Alpha',
    channel: null,
    receivedAt: 1,
    lastSeenAt: 1,
    coordsSource: 'message',
    messageIds: [],
    ackCount: 0,
    ackPeerIds: [],
    beaconActive: false,
    beaconAcked: false,
    isDrill: false,
    status: 'open',
    ...over,
  };
}

describe('incidentMarkersFrom', () => {
  it('keeps unresolved incidents with finite coordinates', () => {
    const out = incidentMarkersFrom({
      a: incident({ id: 'a', lat: 1, lon: 2 }),
      b: incident({ id: 'b', lat: 1, lon: 2, status: 'resolved' }),
      c: incident({ id: 'c' }),
      d: incident({ id: 'd', lat: Number.NaN, lon: 2 }),
      e: incident({ id: 'e', lat: 3, lon: 4, status: 'acked' }),
    });
    expect(out.map((i) => i.id).sort()).toEqual(['a', 'e']);
  });
});

describe('IncidentMarkersLayer', () => {
  beforeEach(() => {
    useIncidentStore.setState({ incidents: {} });
  });

  it('renders nothing without located incidents', () => {
    const { container } = render(<IncidentMarkersLayer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a marker per located open incident with sender tooltip', () => {
    useIncidentStore.setState({
      incidents: { a: incident({ id: 'a', lat: 39.75, lon: -104.99 }) },
    });
    render(<IncidentMarkersLayer />);
    expect(screen.getByTestId('circle').getAttribute('data-center')).toBe('39.75,-104.99');
    expect(screen.getByText(/mapPanel\.incidentMarker:.*Alpha/)).toBeTruthy();
  });
});

describe('MgrsGridLayer', () => {
  it('draws squares for the viewport and re-computes on moveend', () => {
    handlers.clear();
    render(<MgrsGridLayer />);
    expect(screen.getAllByTestId('rect').length).toBeGreaterThan(0);
    expect(handlers.has('moveend')).toBe(true);
  });
});

describe('MeasureControl', () => {
  it('accumulates clicked points and shows total distance', () => {
    handlers.clear();
    render(<MeasureControl />);
    expect(handlers.has('click')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'mapPanel.measureStartAria' }));
    expect(screen.getByRole('status').textContent).toBe('mapPanel.measureHint');
    act(() => {
      handlers.get('click')?.({ latlng: { lat: 0, lng: 0 } });
      handlers.get('click')?.({ latlng: { lat: 0, lng: 1 } });
    });
    expect(screen.getByRole('status').textContent).toMatch(/"km":"111\.\d\d"/);
    expect(screen.getByTestId('polyline')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'mapPanel.measureStopAria' }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(handlers.has('click')).toBe(false);
  });
});
