import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ChannelSecurityBadges } from '@/renderer/components/chat/ChannelSecurityBadges';
import { WrappingChannelList } from '@/renderer/components/chat/WrappingChannelList';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { ChannelSecurityInput } from '@/renderer/lib/channelSecurityBadges';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

async function renderAndAssertAxe(ui: ReactElement): Promise<ReturnType<typeof render>> {
  const view = render(ui);
  hydrateAxeThemeColors(view.container);
  expect(await axe(view.container)).toHaveNoViolations();
  return view;
}

function badgeInList(channel: ChannelSecurityInput, label: string) {
  return (
    <WrappingChannelList activeKey={0}>
      <button type="button" data-channel-unread={0} aria-label="LongFast">
        LongFast
        <ChannelSecurityBadges channel={channel} label={label} />
      </button>
    </WrappingChannelList>
  );
}

describe('ChannelSecurityBadges', () => {
  it('renders an encrypted green closed lock', async () => {
    const view = await renderAndAssertAxe(
      badgeInList(
        { psk: new Uint8Array(32), uplinkEnabled: false, positionPrecision: 0 },
        'encrypted-label',
      ),
    );
    const badge = view.getByLabelText('encrypted-label');
    expect(badge).toHaveAttribute('data-security-level', 'encrypted');
    expect(badge.className).toContain('text-green-400');
    expect(badge.querySelectorAll('svg')).toHaveLength(1);
  });

  it('renders an open orange lock without a warning badge', async () => {
    const view = await renderAndAssertAxe(
      badgeInList(
        { psk: new Uint8Array([0]), uplinkEnabled: true, positionPrecision: 0 },
        'open-label',
      ),
    );
    const badge = view.getByLabelText('open-label');
    expect(badge).toHaveAttribute('data-security-level', 'open');
    expect(badge.className).toContain('text-orange-400');
    expect(badge.className).not.toContain('bg-red-700');
    expect(badge.querySelectorAll('svg')).toHaveLength(1);
  });

  it('renders a red open lock for precise location', async () => {
    const view = await renderAndAssertAxe(
      badgeInList(
        { psk: new Uint8Array([0]), uplinkEnabled: false, positionPrecision: 32 },
        'open-location-label',
      ),
    );
    const badge = view.getByLabelText('open-location-label');
    expect(badge).toHaveAttribute('data-security-level', 'open-location');
    expect(badge.className).toContain('text-red-400');
    expect(badge.querySelectorAll('svg')).toHaveLength(1);
  });

  it('renders a red open lock plus warning for location and MQTT uplink', async () => {
    const view = await renderAndAssertAxe(
      badgeInList(
        { psk: new Uint8Array([0]), uplinkEnabled: true, positionPrecision: 32 },
        'open-location-uplink-label',
      ),
    );
    const badge = view.getByLabelText('open-location-uplink-label');
    expect(badge).toHaveAttribute('data-security-level', 'open-location-uplink');
    expect(badge.className).toContain('text-red-400');
    expect(badge.querySelectorAll('svg')).toHaveLength(2);
  });
});
