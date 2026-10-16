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
    expect(screen.queryByLabelText('ATAK name for Public')).toBeNull();
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
    // Each name field shows the automatic name until the user types one.
    expect(screen.getByLabelText('ATAK name for Public')).toHaveAttribute(
      'placeholder',
      '#MC Public',
    );
    expect(screen.getByLabelText('ATAK name for #sar')).toHaveValue('');

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
    expect(screen.getByLabelText('ATAK name for #sar')).toHaveAttribute('placeholder', '#MC sar');
    expect(screen.queryByLabelText('ATAK name for Public')).toBeNull();
  });

  it('saves a custom ATAK name on Enter or leaving the field, and blanks back to automatic', async () => {
    const user = userEvent.setup();
    useTakRelayPrefsStore.getState().setChannelMode(ID, 'all');
    render(<Section showTrackers={false} />);
    const field = screen.getByLabelText('ATAK name for #sar');

    await user.type(field, 'Search and Rescue');
    // Nothing is sent to ATAK while typing.
    expect(getTakRelayPrefs(ID).atakNames).toEqual({});
    await user.keyboard('{Enter}');
    expect(getTakRelayPrefs(ID).atakNames).toEqual({ 2: 'Search and Rescue' });

    await user.type(field, ' team');
    await user.keyboard('{Escape}');
    expect(field).toHaveValue('Search and Rescue');

    await user.clear(field);
    await user.tab();
    expect(getTakRelayPrefs(ID).atakNames).toEqual({});
    expect(field).toHaveAttribute('placeholder', '#MC sar');
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
