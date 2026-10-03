// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { useTakContactStore } from '@/renderer/stores/takContactStore';
import type { TAKContact } from '@/shared/tak-types';

import { takAffiliation, TakContactsLayer } from './takContactsLayer';

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

describe('takAffiliation', () => {
  it.each([
    ['a-f-G-U-C', 'friend'],
    ['a-a-G', 'friend'],
    ['a-h-G', 'hostile'],
    ['a-s-A', 'hostile'],
    ['a-n-G', 'neutral'],
    ['a-u-G', 'unknown'],
    ['a-p-G', 'unknown'],
    ['b-m-p-s-m', 'point'],
  ])('%s is %s', (type, expected) => {
    expect(takAffiliation(type)).toBe(expected);
  });
});

describe('TakContactsLayer', () => {
  beforeEach(() => {
    useTakContactStore.getState().replaceAll([]);
  });

  it('renders nothing without contacts', () => {
    const { container } = render(<TakContactsLayer />);
    expect(container.innerHTML).toBe('');
  });

  it('renders a marker per contact with callsign, source, group and remarks', async () => {
    useTakContactStore
      .getState()
      .replaceAll([
        contact({ group: 'Cyan', role: 'Team Lead', remarks: 'On scene' }),
        contact({ uid: 'H-1', type: 'a-h-G', callsign: 'BANDIT', source: 'local', lat: 40 }),
      ]);
    const { container } = render(<TakContactsLayer />);

    const circles = screen.getAllByTestId('tak-circle');
    expect(circles.map((c) => c.getAttribute('data-center'))).toEqual([
      '39.75,-104.99',
      '40,-104.99',
    ]);
    expect(circles[0]?.getAttribute('data-color')).not.toBe(circles[1]?.getAttribute('data-color'));
    expect(screen.getAllByText('VIPER').length).toBeGreaterThan(0);
    expect(screen.getByText(/takContacts\.sourceRemote · Cyan · Team Lead/)).toBeTruthy();
    expect(screen.getByText(/takContacts\.sourceLocal/)).toBeTruthy();
    expect(screen.getByText(/takContacts\.affiliationHostile · a-h-G/)).toBeTruthy();
    expect(screen.getByText('On scene')).toBeTruthy();

    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
