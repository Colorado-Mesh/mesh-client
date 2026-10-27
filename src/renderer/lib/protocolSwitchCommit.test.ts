import { describe, expect, it } from 'vitest';

import {
  APP_PANEL_INDEX,
  CHAT_PANEL_INDEX,
  GAMES_PANEL_INDEX,
  NODES_PANEL_INDEX,
} from './appTabMappings';
import {
  beginProtocolSwitch,
  isCurrentProtocolSwitch,
  type ProtocolVisitFlags,
  resetProtocolSwitchGenerationForTests,
  visitFlagsForProtocolCommit,
} from './protocolSwitchCommit';

const ALL_ON: ProtocolVisitFlags = {
  chat: true,
  rooms: true,
  games: true,
  rrc: true,
  remote: true,
  nomad: true,
  peers: true,
  app: true,
};

const ALL_OFF: ProtocolVisitFlags = {
  chat: false,
  rooms: false,
  games: false,
  rrc: false,
  remote: false,
  nomad: false,
  peers: false,
  app: false,
};

describe('protocol switch commit', () => {
  it('lets the latest switch replace one that has not committed', () => {
    resetProtocolSwitchGenerationForTests();
    const earlier = beginProtocolSwitch();
    const later = beginProtocolSwitch();
    expect(isCurrentProtocolSwitch(earlier)).toBe(false);
    expect(isCurrentProtocolSwitch(later)).toBe(true);
    resetProtocolSwitchGenerationForTests();
    expect(isCurrentProtocolSwitch(later)).toBe(false);
  });

  it('clears keep-alive flags on a protocol change and arms only the destination', () => {
    expect(visitFlagsForProtocolCommit(ALL_ON, GAMES_PANEL_INDEX, true, false)).toEqual({
      ...ALL_OFF,
      games: true,
    });
    expect(visitFlagsForProtocolCommit(ALL_ON, APP_PANEL_INDEX, true, true)).toEqual({
      ...ALL_OFF,
      app: true,
    });
  });

  it('arms the peers list only when the destination protocol has one', () => {
    expect(visitFlagsForProtocolCommit(ALL_OFF, NODES_PANEL_INDEX, true, false).peers).toBe(false);
    expect(visitFlagsForProtocolCommit(ALL_OFF, NODES_PANEL_INDEX, true, true).peers).toBe(true);
  });

  it('keeps existing flags when the protocol does not change, including a cancel', () => {
    const current: ProtocolVisitFlags = { ...ALL_OFF, chat: true };
    expect(visitFlagsForProtocolCommit(current, GAMES_PANEL_INDEX, false, false)).toEqual({
      ...current,
      games: true,
    });
    expect(visitFlagsForProtocolCommit(current, null, false, false)).toEqual(current);
  });

  it('arms chat when the destination panel is chat', () => {
    expect(visitFlagsForProtocolCommit(ALL_OFF, CHAT_PANEL_INDEX, true, false).chat).toBe(true);
  });
});
