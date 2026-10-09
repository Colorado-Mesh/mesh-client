import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { IdentityId } from '../lib/types';
import { getTakRelayPrefs, useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../stores/takSinkStore';
import TakChannelRelaySection, { type TakRelayChannel } from './TakChannelRelaySection';

const ID = 'tak-channel-relay-test';
const CHANNELS: TakRelayChannel[] = [
  { index: 0, name: 'Public' },
  { index: 2, name: '#sar' },
];

function Section({
  identityId = ID,
  showTrackers = true,
}: {
  identityId?: IdentityId | null;
  showTrackers?: boolean;
}) {
  return (
    <TakChannelRelaySection
      identityId={identityId}
      channels={CHANNELS}
      showTrackers={showTrackers}
      title="Channels to TAK"
      description="Mirror channels into TAK."
      emptyText="No channels."
      anchorId="tak.channelRelay.test"
    />
  );
}

beforeEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  setTakSinkActive(true);
});

afterEach(() => {
  setTakSinkActive(false);
  useTakRelayPrefsStore.setState({ byIdentity: {} });
});

describe('TakChannelRelaySection', () => {
  it('renders nothing without an active TAK sink or identity', () => {
    setTakSinkActive(false);
    const { container, rerender } = render(<Section />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      setTakSinkActive(true);
    });
    rerender(<Section identityId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('enables tracker fixes per channel', async () => {
    const user = userEvent.setup();
    render(<Section />);
    const rows = screen.getAllByLabelText('Tracker fixes');
    expect(rows).toHaveLength(2);
    await user.click(rows[1]);
    expect(getTakRelayPrefs(ID).trackerChannels).toEqual([2]);
  });

  it('hides tracker fixes when the protocol has no tracker channels', () => {
    render(<Section showTrackers={false} />);
    expect(screen.queryByLabelText('Tracker fixes')).toBeNull();
    expect(screen.getByLabelText('GeoChat room for Public')).toBeInTheDocument();
  });

  it('shows the empty text without channels', () => {
    render(
      <TakChannelRelaySection
        identityId={ID}
        channels={[]}
        showTrackers={false}
        title="Channels to TAK"
        description="Mirror channels into TAK."
        emptyText="No channels."
        anchorId="tak.channelRelay.test"
      />,
    );
    expect(screen.getByText('No channels.')).toBeInTheDocument();
  });

  it.each([true, false])(
    'saves a GeoChat room on blur and clears it when emptied (trackers %s)',
    async (showTrackers) => {
      const user = userEvent.setup();
      render(<Section showTrackers={showTrackers} />);
      const room = screen.getByLabelText('GeoChat room for #sar');
      await user.type(room, 'SAR Team');
      expect(getTakRelayPrefs(ID).chatBridges).toEqual({});
      await user.tab();
      expect(getTakRelayPrefs(ID).chatBridges).toEqual({ 2: 'SAR Team' });
      await user.clear(screen.getByLabelText('GeoChat room for #sar'));
      await user.keyboard('{Enter}');
      expect(getTakRelayPrefs(ID).chatBridges).toEqual({});
    },
  );

  it.each([true, false])('has no axe violations (trackers %s)', async (showTrackers) => {
    const { container } = render(<Section showTrackers={showTrackers} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
