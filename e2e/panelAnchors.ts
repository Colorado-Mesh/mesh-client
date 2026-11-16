import { TAB_SLOT_IDS, type TabSlotId } from '../src/renderer/lib/tabSlotIds';

/** Deep per-panel assertion; absent slots fall back to the generic richness rule. */
export interface PanelContentAnchor {
  /** CSS selector, relative to the panel container. Must be structural, never copy. */
  selector: string;
  /** Why this element proves the panel rendered. */
  note: string;
}

export const PANEL_CONTENT_ANCHORS: Partial<Record<TabSlotId, PanelContentAnchor>> = {
  Radio: { selector: '[data-setting-anchor^="radio."]', note: 'Radio/Network settings' },
  Admin: { selector: '[data-setting-anchor^="admin."]', note: 'Admin commands/settings' },
  Stats: { selector: '[data-setting-anchor="stats.packets.view"]', note: 'Packet view toggle' },
  App: { selector: '[data-setting-anchor="app.protocols.enabled"]', note: 'App settings' },
  Diagnostics: {
    selector: '[data-setting-anchor^="diagnostics."]',
    note: 'Diagnostics settings',
  },
  Telemetry: {
    selector: '[data-setting-anchor="telemetry.display.temperatureUnit"]',
    note: 'Telemetry display',
  },
  Security: {
    selector: '[data-setting-anchor="security.dmKeys.publicKey"]',
    note: 'DM keys',
  },
  TAK: { selector: '[data-setting-anchor="tak.server.port"]', note: 'TAK server config' },
  ScheduledBroadcasts: {
    selector: '[data-setting-anchor="scheduledBroadcasts.enabled"]',
    note: 'Broadcast scheduler',
  },
};

/** Slots covered only by the generic richness rule + `data-panel-anchor` marker. */
export const GENERIC_CONTENT_SLOTS: readonly { slot: TabSlotId; reason: string }[] = [
  {
    slot: 'Connection',
    reason: 'Connect control only when LoRa disconnected; Reticulum uses stack',
  },
  { slot: 'Chat', reason: 'Composer and channel list' },
  { slot: 'Friends', reason: 'Friends list / empty state' },
  { slot: 'Games', reason: 'LRGP game browser' },
  { slot: 'RRC', reason: 'RRC hub/chat UI' },
  { slot: 'NomadNetwork', reason: 'Nomad Network browser' },
  { slot: 'Remote', reason: 'Remote/rnsh controls' },
  { slot: 'Nodes', reason: 'Node/contact/peer list' },
  { slot: 'Map', reason: 'Map shell or Leaflet canvas' },
  { slot: 'Modules', reason: 'Modules config or Repeaters list' },
  { slot: 'Rooms', reason: 'Room list chrome (login-all only when rooms exist)' },
  { slot: 'RoomServers', reason: 'Discovered room servers directory' },
  { slot: 'Incident', reason: 'Incident Command UI' },
  { slot: 'Sniffer', reason: 'Raw packet log table' },
  { slot: 'RF', reason: 'RF histograms or empty state' },
  { slot: 'Graph', reason: 'Peer graph or empty state' },
  { slot: 'Topology', reason: 'Reticulum topology view' },
  { slot: 'TeamContacts', reason: 'Contact Cards list' },
  { slot: 'TeamRoster', reason: 'Team Roster list' },
];

/** Every tab slot must appear in content anchors or the generic list. */
export function assertPanelAnchorContractComplete(): void {
  const covered = new Set<string>([
    ...Object.keys(PANEL_CONTENT_ANCHORS),
    ...GENERIC_CONTENT_SLOTS.map((row) => row.slot),
  ]);
  for (const slot of TAB_SLOT_IDS) {
    if (!covered.has(slot)) {
      throw new Error(
        `Tab slot "${slot}" missing from PANEL_CONTENT_ANCHORS / GENERIC_CONTENT_SLOTS`,
      );
    }
  }
  for (const key of Object.keys(PANEL_CONTENT_ANCHORS)) {
    if (!(TAB_SLOT_IDS as readonly string[]).includes(key)) {
      throw new Error(`PANEL_CONTENT_ANCHORS has unknown slot "${key}"`);
    }
  }
  for (const row of GENERIC_CONTENT_SLOTS) {
    if (!(TAB_SLOT_IDS as readonly string[]).includes(row.slot)) {
      throw new Error(`GENERIC_CONTENT_SLOTS has unknown slot "${row.slot}"`);
    }
  }
}
