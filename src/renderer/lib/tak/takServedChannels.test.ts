import { afterEach, describe, expect, it } from 'vitest';

import { computeChannelIdentityKey } from '@/shared/channelIdentityKey';
import { MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES } from '@/shared/meshtasticDefaultPublicPsk';

import { setTakChannels, useTakChannelStore } from '../../stores/takChannelStore';
import { useTakRelayPrefsStore } from '../../stores/takRelayPrefsStore';
import {
  findServedChannel,
  listTakServedChannels,
  meshcoreTakChannels,
  meshtasticTakChannels,
  servedChannelsFor,
  toTakChatChannels,
} from './takServedChannels';

const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
const PUBLIC = fromHex('8b3387e9c5cdea6ac9e5edbaa115cd72');
const PRIVATE = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

afterEach(() => {
  useTakChannelStore.setState({ channelsByIdentity: {} });
  useTakRelayPrefsStore.setState({ byIdentity: {} });
});

describe('meshcoreTakChannels', () => {
  it('lists configured channels in slot order with their keys and ATAK names', () => {
    const channels = meshcoreTakChannels([
      { index: 2, name: 'Ops', secret: PRIVATE },
      { index: 0, name: 'Public', secret: PUBLIC },
    ]);
    expect(channels).toEqual([
      {
        protocol: 'meshcore',
        index: 0,
        key: computeChannelIdentityKey('meshcore', 'Public', PUBLIC),
        name: 'Public',
        atakName: '#MC Public',
      },
      {
        protocol: 'meshcore',
        index: 2,
        key: computeChannelIdentityKey('meshcore', 'Ops', PRIVATE),
        name: 'Ops',
        atakName: '#MC \u{1F512} Ops',
      },
    ]);
  });

  it('leaves out unset slots, repeats and malformed entries', () => {
    expect(
      meshcoreTakChannels([
        { index: 1, name: '', secret: PRIVATE },
        { index: 2, name: 'Empty', secret: new Uint8Array(16) },
        { index: 3, name: 'Short', secret: new Uint8Array(8) },
        { index: -1, name: 'Bad', secret: PRIVATE },
        { index: 4, name: 'First', secret: PRIVATE },
        { index: 4, name: 'Second', secret: PUBLIC },
        null,
        'x',
      ]).map((c) => c.name),
    ).toEqual(['First']);
  });
});

describe('meshtasticTakChannels', () => {
  it('names an unnamed primary LongFast and leaves disabled slots out', () => {
    const channels = meshtasticTakChannels([
      { index: 0, name: '', role: 1, psk: MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES },
      { index: 1, name: 'Ops', role: 2, psk: PRIVATE },
      { index: 2, name: 'Off', role: 0, psk: PRIVATE },
      { index: 3, name: 'NoKey', role: 2 },
    ]);
    expect(channels.map((c) => [c.index, c.name, c.atakName])).toEqual([
      [0, 'LongFast', '#MT LongFast'],
      [1, 'Ops', '#MT \u{1F512} Ops'],
    ]);
    expect(channels[0]?.key).toBe(
      computeChannelIdentityKey('meshtastic', '', MESHTASTIC_DEFAULT_PUBLIC_PSK_BYTES),
    );
  });

  it('gives an unnamed secondary slot an empty name and a plain ATAK name', () => {
    const [channel] = meshtasticTakChannels([{ index: 3, name: '', role: 2, psk: PRIVATE }]);
    expect(channel).toMatchObject({ name: '', atakName: '#MT \u{1F512} Channel 3' });
  });
});

describe('served channels', () => {
  const channels = meshcoreTakChannels([
    { index: 0, name: 'Public', secret: PUBLIC },
    { index: 2, name: 'Ops', secret: PRIVATE },
  ]);
  const [publicKey, opsKey] = channels.map((c) => c.key);
  const prefs = {
    trackerChannels: [],
    chatChannels: [opsKey],
    sendChannels: [opsKey],
    remoteChannels: [publicKey],
    noCallsignChannels: [publicKey],
    atakNames: {},
    directMessages: false,
  };

  it('serves nothing when off, everything when all, and the picked ones when selected', () => {
    expect(servedChannelsFor('mc', channels, { ...prefs, channelMode: 'off' })).toEqual([]);
    expect(servedChannelsFor('mc', channels, undefined)).toEqual([]);
    expect(
      servedChannelsFor('mc', channels, { ...prefs, channelMode: 'all' }).map((c) => [
        c.index,
        c.send,
        c.remote,
        c.callsign,
      ]),
    ).toEqual([
      [0, false, true, false],
      [2, true, false, true],
    ]);
    expect(
      servedChannelsFor('mc', channels, { ...prefs, channelMode: 'selected' }).map((c) => c.index),
    ).toEqual([2]);
  });

  it('sends a name the user chose in place of the automatic one', () => {
    const served = servedChannelsFor('mc', channels, {
      ...prefs,
      channelMode: 'all',
      atakNames: { [opsKey]: 'Ops Net' },
    });
    expect(served.map((c) => c.atakName)).toEqual(['#MC Public', 'Ops Net']);
    expect(toTakChatChannels(served).map((c) => c.name)).toEqual(['#MC Public', 'Ops Net']);
  });

  it('finds a served channel by radio and slot, reading the stores', () => {
    setTakChannels('mc', channels);
    useTakRelayPrefsStore.setState({ byIdentity: { mc: { ...prefs, channelMode: 'selected' } } });
    expect(findServedChannel('mc', 2)).toMatchObject({
      identityId: 'mc',
      atakName: '#MC \u{1F512} Ops',
    });
    expect(findServedChannel('mc', 0)).toBeUndefined();
    expect(findServedChannel('other', 2)).toBeUndefined();
    expect(listTakServedChannels()).toHaveLength(1);
  });

  it('merges a channel served on two radios into one contact for main', () => {
    const [ops] = servedChannelsFor('a', channels.slice(1), { ...prefs, channelMode: 'all' });
    const twin = {
      ...ops,
      identityId: 'b',
      atakName: '#MC \u{1F512} Ops (b)',
      send: false,
      remote: true,
    };
    expect(toTakChatChannels([ops, twin])).toEqual([
      { key: ops.key, name: '#MC \u{1F512} Ops', send: true, remote: true },
    ]);
  });
});
