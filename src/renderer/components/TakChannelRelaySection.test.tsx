import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { IdentityId } from '../lib/types';
import { setTakChannels, useTakChannelStore } from '../stores/takChannelStore';
import { getTakRelayPrefs, useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../stores/takSinkStore';
import TakChannelRelaySection from './TakChannelRelaySection';

const ID = 'tak-channel-relay-test';

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
      showTrackers={showTrackers}
      title="MeshCore messaging in ATAK"
      description="Choose channels."
      emptyText="No channels."
      anchorId="tak.channelRelay.test"
    />
  );
}

beforeEach(() => {
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  setTakChannels(ID, [
    {
      protocol: 'meshcore',
      index: 0,
      key: '0123456789abcdef',
      name: 'Public',
      atakName: '#MC Public',
    },
    { protocol: 'meshcore', index: 2, key: 'fedcba9876543210', name: '#sar', atakName: '#MC sar' },
  ]);
  setTakSinkActive(true);
});

afterEach(() => {
  setTakSinkActive(false);
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  useTakChannelStore.setState({ channelsByIdentity: {} });
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

  it('starts with channels off and only the tracker checkboxes', () => {
    render(<Section />);
    expect(screen.getByLabelText('Channels in ATAK')).toHaveValue('off');
    expect(screen.getAllByLabelText(/^Tracker fixes from/)).toHaveLength(2);
    expect(screen.queryByLabelText('Let ATAK devices send to Public')).toBeNull();
    expect(screen.queryByText('In ATAK as #MC Public')).toBeNull();
  });

  it('enables tracker fixes per channel', async () => {
    const user = userEvent.setup();
    render(<Section />);
    await user.click(screen.getByLabelText('Tracker fixes from #sar'));
    expect(getTakRelayPrefs(ID).trackerChannels).toEqual([2]);
  });

  it('serves every channel in All mode, showing each ATAK name and its two options', async () => {
    const user = userEvent.setup();
    render(<Section showTrackers={false} />);
    await user.selectOptions(screen.getByLabelText('Channels in ATAK'), 'all');
    expect(getTakRelayPrefs(ID).channelMode).toBe('all');
    expect(screen.getByText('In ATAK as #MC Public')).toBeInTheDocument();
    expect(screen.getByText('In ATAK as #MC sar')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Let ATAK devices send to #sar'));
    await user.click(screen.getByLabelText('Stream Public to the remote TAK server'));
    expect(getTakRelayPrefs(ID)).toMatchObject({ sendChannels: [2], remoteChannels: [0] });
    expect(screen.getByLabelText('Let ATAK devices send to #sar')).toBeChecked();
    expect(screen.getByLabelText('Let ATAK devices send to Public')).not.toBeChecked();
  });

  it('serves only the picked channels in Selected mode', async () => {
    const user = userEvent.setup();
    render(<Section showTrackers={false} />);
    await user.selectOptions(screen.getByLabelText('Channels in ATAK'), 'selected');
    expect(screen.queryByLabelText('Let ATAK devices send to #sar')).toBeNull();

    await user.click(screen.getByLabelText('Show #sar in ATAK'));
    expect(getTakRelayPrefs(ID).chatChannels).toEqual([2]);
    expect(screen.getByLabelText('Let ATAK devices send to #sar')).toBeInTheDocument();
    expect(screen.queryByLabelText('Let ATAK devices send to Public')).toBeNull();
    expect(screen.getByText('In ATAK as #MC sar')).toBeInTheDocument();
  });

  it('shows the empty text without channels', () => {
    useTakChannelStore.setState({ channelsByIdentity: {} });
    render(<Section />);
    expect(screen.getByText('No channels.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Channels in ATAK')).toBeNull();
  });

  it.each([true, false])('has no axe violations (trackers %s)', async (showTrackers) => {
    useTakRelayPrefsStore.getState().setChannelMode(ID, 'selected');
    useTakRelayPrefsStore.getState().setChatChannel(ID, 2, true);
    const { container } = render(<Section showTrackers={showTrackers} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
