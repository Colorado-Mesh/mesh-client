import { create } from 'zustand';

import type { ChannelIdentityProtocol } from '@/shared/channelIdentityKey';

import type { IdentityId } from '../lib/types';

/** One configured channel on a radio, as TAK sees it. */
export interface TakChannelInfo {
  protocol: ChannelIdentityProtocol;
  index: number;
  /** Channel identity key (`channelIdentityKey.ts`); the ATAK contact's uid comes from it. */
  key: string;
  /** Name shown in mesh-client. */
  name: string;
  /** Name of the channel's contact in ATAK, e.g. `#MC Public`. */
  atakName: string;
}

interface TakChannelStoreState {
  /** Each radio's configured channels, in slot order. */
  channelsByIdentity: Record<IdentityId, readonly TakChannelInfo[]>;
}

export const useTakChannelStore = create<TakChannelStoreState>()(() => ({
  channelsByIdentity: {},
}));

const NO_CHANNELS: readonly TakChannelInfo[] = [];

function sameChannels(a: readonly TakChannelInfo[], b: readonly TakChannelInfo[]): boolean {
  return (
    a.length === b.length &&
    a.every(
      (c, i) =>
        c.index === b[i].index &&
        c.key === b[i].key &&
        c.name === b[i].name &&
        c.atakName === b[i].atakName,
    )
  );
}

/** Publish a radio's channel list; an equal list leaves the store untouched. */
export function setTakChannels(identityId: IdentityId, channels: readonly TakChannelInfo[]): void {
  useTakChannelStore.setState((s) => {
    const prev = s.channelsByIdentity[identityId] ?? NO_CHANNELS;
    if (sameChannels(prev, channels)) return s;
    return { channelsByIdentity: { ...s.channelsByIdentity, [identityId]: channels } };
  });
}

export function getTakChannels(identityId: IdentityId): readonly TakChannelInfo[] {
  return useTakChannelStore.getState().channelsByIdentity[identityId] ?? NO_CHANNELS;
}
