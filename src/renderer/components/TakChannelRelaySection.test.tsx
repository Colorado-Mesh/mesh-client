import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { upsertMeshcoreChannel, useDeviceStore } from '../stores/deviceStore';
import { getTakRelayPrefs, useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { setTakSinkActive } from '../stores/takSinkStore';
import TakChannelRelaySection from './TakChannelRelaySection';

const ID = 'tak-channel-relay-test';

beforeEach(() => {
  useDeviceStore.setState({ devices: {} });
  useTakRelayPrefsStore.setState({ byIdentity: {} });
  upsertMeshcoreChannel(ID, { index: 0, name: 'Public', key: new Uint8Array(16) });
  upsertMeshcoreChannel(ID, { index: 2, name: '#sar', key: new Uint8Array(16) });
  setTakSinkActive(true);
});

afterEach(() => {
  setTakSinkActive(false);
  useTakRelayPrefsStore.setState({ byIdentity: {} });
});

describe('TakChannelRelaySection', () => {
  it('renders nothing without an active TAK sink or identity', () => {
    setTakSinkActive(false);
    const { container, rerender } = render(<TakChannelRelaySection identityId={ID} />);
    expect(container).toBeEmptyDOMElement();
    act(() => {
      setTakSinkActive(true);
    });
    rerender(<TakChannelRelaySection identityId={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('enables tracker fixes per channel', async () => {
    const user = userEvent.setup();
    render(<TakChannelRelaySection identityId={ID} />);
    const rows = screen.getAllByLabelText('Tracker fixes');
    expect(rows).toHaveLength(2);
    await user.click(rows[1]);
    expect(getTakRelayPrefs(ID).trackerChannels).toEqual([2]);
  });

  it('saves a GeoChat room on blur and clears it when emptied', async () => {
    const user = userEvent.setup();
    render(<TakChannelRelaySection identityId={ID} />);
    const room = screen.getByLabelText('GeoChat room for #sar');
    await user.type(room, 'SAR Team');
    expect(getTakRelayPrefs(ID).chatBridges).toEqual({});
    await user.tab();
    expect(getTakRelayPrefs(ID).chatBridges).toEqual({ 2: 'SAR Team' });
    await user.clear(screen.getByLabelText('GeoChat room for #sar'));
    await user.keyboard('{Enter}');
    expect(getTakRelayPrefs(ID).chatBridges).toEqual({});
  });

  it('has no axe violations', async () => {
    const { container } = render(<TakChannelRelaySection identityId={ID} />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
