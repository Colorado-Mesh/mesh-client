/** Stable English tab slot ids (icons, shortcuts, chat badge) — not for display. */
export const TAB_SLOT_IDS = [
  'Connection',
  'Chat',
  'Nodes',
  'Map',
  'Radio',
  'Modules',
  'Admin',
  'Rooms',
  'Telemetry',
  'Security',
  'TAK',
  'App',
  'Diagnostics',
  'Stats',
  'Sniffer',
  'RF',
  'Graph',
] as const;

export type TabSlotId = (typeof TAB_SLOT_IDS)[number];

/** Icon slot ids including capability-driven aliases (Contacts, Repeaters). */
export type TabIconSlotId = TabSlotId | 'Contacts' | 'Repeaters';
