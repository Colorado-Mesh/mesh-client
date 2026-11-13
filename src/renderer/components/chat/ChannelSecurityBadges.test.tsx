import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ChannelSecurityBadges } from '@/renderer/components/chat/ChannelSecurityBadges';
import { WrappingChannelList } from '@/renderer/components/chat/WrappingChannelList';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { channel?: string }) =>
      opts?.channel ? `${key}:${opts.channel}` : key,
  }),
}));

async function renderAndAssertAxe(ui: ReactElement): Promise<ReturnType<typeof render>> {
  const view = render(ui);
  hydrateAxeThemeColors(view.container);
  expect(await axe(view.container)).toHaveNoViolations();
  return view;
}

describe('ChannelSecurityBadges', () => {
  it('renders accessible badges inside WrappingChannelList', async () => {
    const view = await renderAndAssertAxe(
      <WrappingChannelList activeKey={0}>
        <button type="button" data-channel-unread={0} aria-label="LongFast">
          LongFast
          <ChannelSecurityBadges
            channelName="LongFast"
            channel={{
              psk: new Uint8Array([0]),
              uplinkEnabled: true,
              positionPrecision: 32,
            }}
          />
        </button>
      </WrappingChannelList>,
    );
    const weak = view.getByLabelText('channelSecurityBadges.pskWeak:LongFast');
    expect(weak).toBeTruthy();
    expect(weak).not.toHaveTextContent('Open');
    expect(weak).not.toHaveTextContent('channelSecurityBadges.pskWeakShort');
    expect(weak.querySelector('svg')).toBeTruthy();
    expect(weak.className).toContain('text-orange-400');
    expect(weak.className).not.toContain('bg-red-700');
    expect(weak.className).not.toContain('bg-orange-800');
    expect(view.getByLabelText('channelSecurityBadges.preciseLocation:LongFast')).toBeTruthy();
    expect(view.getByLabelText('channelSecurityBadges.mqttUplink:LongFast')).toBeTruthy();
  });
});
