import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import type { IdentityId } from '../lib/types';
import { setTakChannels, useTakChannelStore } from '../stores/takChannelStore';
import { getTakRelayPrefs, useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../stores/takSinkStore';
import TakChannelRelaySection, {
  TakDirectMessagesSection,
  TakDirectMessagesToggle,
} from './TakChannelRelaySection';

const ID = 'tak-channel-relay-test';
const PUBLIC = '0123456789abcdef';
const SAR = 'fedcba9876543210';

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
      key: PUBLIC,
      name: 'Public',
      atakName: '#MC Public',
    },
    { protocol: 'meshcore', index: 2, key: SAR, name: '#sar', atakName: '#MC sar' },
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
    expect(getTakRelayPrefs(ID)).toMatchObject({ sendChannels: [SAR], remoteChannels: [PUBLIC] });
    expect(screen.getByLabelText('Let ATAK devices send to #sar')).toBeChecked();
    expect(screen.getByLabelText('Let ATAK devices send to Public')).not.toBeChecked();
  });

  it('serves only the picked channels in Selected mode', async () => {
    const user = userEvent.setup();
    render(<Section showTrackers={false} />);
    await user.selectOptions(screen.getByLabelText('Channels in ATAK'), 'selected');
    expect(screen.queryByLabelText('Let ATAK devices send to #sar')).toBeNull();

    await user.click(screen.getByLabelText('Show #sar in ATAK'));
    expect(getTakRelayPrefs(ID).chatChannels).toEqual([SAR]);
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
    expect(getTakRelayPrefs(ID).atakNames).toEqual({ [SAR]: 'Search and Rescue' });

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
    useTakRelayPrefsStore.getState().setChatChannel(ID, SAR, true);
    const { container } = render(<Section showTrackers={showTrackers} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('turns direct messages on and off for the radio, inside its section', async () => {
    render(
      <TakChannelRelaySection
        identityId={ID}
        showTrackers={false}
        title="MeshCore messaging in ATAK"
        description="Choose channels."
        emptyText="No channels."
        anchorId="tak.channelRelay.test"
      >
        <TakDirectMessagesToggle identityId={ID} anchorId="tak.directMessages.test" />
      </TakChannelRelaySection>,
    );
    const toggle = screen.getByLabelText('Direct messages');
    expect(toggle).not.toBeChecked();
    expect(toggle).toHaveAccessibleDescription(/last wrote to it/);
    await userEvent.click(toggle);
    expect(getTakRelayPrefs(ID).directMessages).toBe(true);
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(getTakRelayPrefs(ID).directMessages).toBe(false);
  });

  it('shows no direct message switch without a radio', () => {
    const { container } = render(
      <TakDirectMessagesToggle identityId={null} anchorId="tak.directMessages.test" />,
    );
    expect(container).toBeEmptyDOMElement();
  });
  it('offers Add callsign once a channel can send, on by default, and turns it off', async () => {
    const user = userEvent.setup();
    useTakRelayPrefsStore.getState().setChannelMode(ID, 'all');
    render(<Section showTrackers={false} />);
    expect(screen.queryByLabelText(/callsign in front of messages sent to #sar/)).toBeNull();
    await user.click(screen.getByLabelText('Let ATAK devices send to #sar'));
    const callsign = screen.getByLabelText(
      "Put the sender's ATAK callsign in front of messages sent to #sar",
    );
    expect(callsign).toBeChecked();
    await user.click(callsign);
    expect(getTakRelayPrefs(ID).noCallsignChannels).toEqual([SAR]);
    expect(callsign).not.toBeChecked();
    expect(screen.getByText(/Turn it off for a bot channel/)).toBeInTheDocument();
  });

  it("keeps a channel's settings with the channel when another takes its slot", async () => {
    const user = userEvent.setup();
    useTakRelayPrefsStore.getState().setChannelMode(ID, 'all');
    render(<Section showTrackers={false} />);
    await user.click(screen.getByLabelText('Let ATAK devices send to #sar'));
    expect(getTakRelayPrefs(ID).sendChannels).toEqual([SAR]);
    // A different channel is now in slot 2: it does not inherit "ATAK can send".
    act(() => {
      setTakChannels(ID, [
        { protocol: 'meshcore', index: 0, key: PUBLIC, name: 'Public', atakName: '#MC Public' },
        {
          protocol: 'meshcore',
          index: 2,
          key: 'aaaaaaaaaaaaaaaa',
          name: 'Ops',
          atakName: '#MC 🔒 Ops',
        },
      ]);
    });
    expect(screen.getByLabelText('Let ATAK devices send to Ops')).not.toBeChecked();
  });

  it('gives Reticulum a section with its direct message switch alone, while a sink is up', async () => {
    const user = userEvent.setup();
    const section = (
      <TakDirectMessagesSection
        identityId="rn"
        title="Reticulum messaging in ATAK"
        description="Let ATAK devices message LXMF peers."
        anchorId="tak.directMessages.reticulum"
      />
    );
    const { container, rerender } = render(section);
    expect(screen.getByText('Reticulum messaging in ATAK')).toBeInTheDocument();
    expect(screen.queryByLabelText('Channels in ATAK')).toBeNull();
    await user.click(screen.getByLabelText('Direct messages'));
    expect(getTakRelayPrefs('rn').directMessages).toBe(true);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();

    act(() => {
      setTakSinkActive(false);
    });
    rerender(section);
    expect(container).toBeEmptyDOMElement();
  });
});
