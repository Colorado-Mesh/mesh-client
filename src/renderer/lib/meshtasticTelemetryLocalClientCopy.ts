/**
 * Shared UI copy: Meshtastic mesh telemetry interval vs local-to-connected-client
 * device metrics refresh (often ~60s). See docs/meshtastic-telemetry-local-client.md.
 */

export const MESHTASTIC_TELEMETRY_MODULE_DOC_URL =
  'https://meshtastic.org/docs/configuration/module/telemetry';

/** Radio panel — `device_update_interval` (device metrics over mesh + client note). */
export const MESHTASTIC_RADIO_DEVICE_METRICS_DESCRIPTION =
  'Mesh broadcast: how often battery, voltage, and channel utilization are sent over LoRa. 0 = disabled; default 1800 s (30 min). ' +
  'Connected app: when linked over Bluetooth, serial, or Wi-Fi, the firmware often still pushes device metrics to this client about every 60 s for on-screen freshness—that is not the same as your mesh interval.';

/** Module panel — telemetry module device metrics interval. */
export const MESHTASTIC_MODULE_DEVICE_METRICS_DESCRIPTION =
  'Mesh broadcast: how often battery, voltage, and channel utilization are sent over LoRa via the telemetry module. 0 = disabled. ' +
  'Connected app: when linked, device metrics to this client often refresh about every 60 s—separate from the mesh/module interval.';

export const MESHTASTIC_DEVICE_METRICS_HELP_TOOLTIP =
  'Meshtastic firmware sends device metrics to a connected client roughly once per minute for local monitoring, regardless of the mesh telemetry interval. Official reference: ' +
  MESHTASTIC_TELEMETRY_MODULE_DOC_URL;
