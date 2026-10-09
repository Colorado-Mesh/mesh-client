// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useTakContactStore } from '@/renderer/stores/takContactStore';
import type { TAKContact } from '@/shared/tak-types';

import { TakContactsLayer } from './takContactsLayer';

vi.mock('leaflet', () => ({
  default: { divIcon: (options: { html: string }) => ({ options }) },
}));

vi.mock('react-leaflet', () => ({
  CircleMarker: ({
    children,
    center,
    pathOptions,
  }: {
    children?: ReactNode;
    center: [number, number];
    pathOptions: { color: string };
  }) => (
    <div data-testid="tak-circle" data-center={center.join(',')} data-color={pathOptions.color}>
      {children}
    </div>
  ),
  Marker: ({
    children,
    position,
    icon,
    title,
  }: {
    children?: ReactNode;
    position: [number, number];
    icon: { options: { html: string } };
    title: string;
  }) => (
    <div data-testid="tak-marker" data-center={position.join(',')} title={title}>
      <span data-testid="tak-icon" dangerouslySetInnerHTML={{ __html: icon.options.html }} />
      {children}
    </div>
  ),
  Tooltip: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Popup: ({ children }: { children?: ReactNode }) => <div data-testid="popup">{children}</div>,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${JSON.stringify(opts)}` : key,
  }),
}));

function contact(over: Partial<TAKContact>): TAKContact {
  return {
    uid: 'ANDROID-1',
    type: 'a-f-G-U-C',
    callsign: 'VIPER',
    lat: 39.75,
    lon: -104.99,
    source: 'remote',
    receivedAt: Date.now(),
    staleAt: Date.now() + 60_000,
    ...over,
  };
}

describe('TakContactsLayer', () => {
  beforeEach(() => {
    useTakContactStore.getState().replaceAll([]);
  });

  it('renders nothing without contacts', () => {
    const { container } = render(<TakContactsLayer />);
    expect(container.innerHTML).toBe('');
  });

  it('draws units as symbol markers with callsign, source, group and remarks', async () => {
    useTakContactStore
      .getState()
      .replaceAll([
        contact({ group: 'Cyan', role: 'Team Lead', remarks: 'On scene' }),
        contact({ uid: 'H-1', type: 'a-h-G', callsign: 'BANDIT', source: 'local', lat: 40 }),
      ]);
    const { container } = render(<TakContactsLayer />);

    const markers = screen.getAllByTestId('tak-marker');
    expect(markers.map((m) => m.getAttribute('data-center'))).toEqual([
      '39.75,-104.99',
      '40,-104.99',
    ]);
    expect(markers.map((m) => m.getAttribute('title'))).toEqual(['VIPER', 'BANDIT']);
    const icons = screen.getAllByTestId('tak-icon');
    expect(icons[0]?.innerHTML).not.toBe(icons[1]?.innerHTML);
    expect(icons[0]?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getAllByText('VIPER').length).toBeGreaterThan(0);
    expect(screen.getByText(/takContacts\.sourceRemote · Cyan · Team Lead/)).toBeTruthy();
    expect(screen.getByText(/takContacts\.sourceLocal/)).toBeTruthy();
    expect(screen.getByText(/takContacts\.affiliationHostile · a-h-G/)).toBeTruthy();
    expect(screen.getByText('On scene')).toBeTruthy();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('keeps contact text out of the icon markup', () => {
    useTakContactStore
      .getState()
      .replaceAll([contact({ callsign: '<img src=x onerror=alert(1)>', remarks: '<b>x</b>' })]);
    render(<TakContactsLayer />);
    const html = screen.getByTestId('tak-icon').innerHTML;
    expect(html).not.toContain('img');
    expect(html).not.toContain('<b>');
  });

  it('draws map points as dashed circles', async () => {
    useTakContactStore
      .getState()
      .replaceAll([contact({ uid: 'P-1', type: 'b-m-p-s-m', callsign: 'RALLY' })]);
    const { container } = render(<TakContactsLayer />);
    expect(screen.queryByTestId('tak-marker')).toBeNull();
    expect(screen.getByTestId('tak-circle')).toBeTruthy();
    expect(screen.getByText(/takContacts\.affiliationPoint/)).toBeTruthy();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
