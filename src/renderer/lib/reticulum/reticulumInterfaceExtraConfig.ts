/**
 * Form-managed / typed interface INI keys. Advanced editor entries that collide
 * with these are ignored (typed fields win). Keep aligned with sidecar
 * `KNOWN_IFACE_CONFIG_KEYS` for structured fields; pipe `command` is omitted so
 * it can survive via `extra_config` until modeled.
 */
export const KNOWN_IFACE_UI_KEYS: ReadonlySet<string> = new Set([
  'type',
  'enabled',
  'interface_enabled',
  'target_host',
  'target_port',
  'name',
  'peers',
  'port',
  'frequency',
  'bandwidth',
  'txpower',
  'spreadingfactor',
  'spreading_factor',
  'codingrate',
  'coding_rate',
  'callsign',
  'id_interval',
  'mode',
  'preset',
  'seed_addresses',
  'discoverable',
  'latitude',
  'longitude',
  'height',
  'discovery_name',
  'announce_interval',
  'connectable',
  'reachable_on',
  'network_name',
  'passphrase',
]);

export function isKnownIfaceUiKey(key: string): boolean {
  return KNOWN_IFACE_UI_KEYS.has(key.trim().toLowerCase());
}

/** Serialize `extra_config` for the Advanced textarea (`key = value` lines). */
export function formatInterfaceExtraConfig(
  extra: Record<string, string> | null | undefined,
): string {
  if (!extra) return '';
  return Object.entries(extra)
    .filter(([key]) => key.trim().length > 0)
    .map(([key, value]) => `${key} = ${value}`)
    .join('\n');
}

export interface ParseInterfaceExtraConfigResult {
  extraConfig: Record<string, string>;
  /** Keys that collide with typed/UI fields and were dropped. */
  reservedKeys: string[];
}

/**
 * Parse Advanced textarea lines into `extra_config`. Blank lines and `#` comments
 * are ignored. Reserved keys are omitted and listed in `reservedKeys`.
 */
export function parseInterfaceExtraConfig(text: string): ParseInterfaceExtraConfigResult {
  const extraConfig: Record<string, string> = {};
  const reservedKeys: string[] = [];
  const seenReserved = new Set<string>();

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!key) continue;
    if (isKnownIfaceUiKey(key)) {
      const lower = key.toLowerCase();
      if (!seenReserved.has(lower)) {
        seenReserved.add(lower);
        reservedKeys.push(key);
      }
      continue;
    }
    extraConfig[key] = value;
  }

  return { extraConfig, reservedKeys };
}
