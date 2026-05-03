import type { MeshNode } from './types';

/** True when the node is not MQTT-only and either session MQTT or packet via_mqtt applies. */
export function meshtasticNodeShowsHybridMqttPath(
  node: Pick<MeshNode, 'heard_via_mqtt' | 'heard_via_mqtt_only' | 'via_mqtt'>,
): boolean {
  if (node.heard_via_mqtt_only) return false;
  return Boolean(node.heard_via_mqtt) || Boolean(node.via_mqtt);
}

/** Tooltip for hybrid RF + MQTT path (list column + node detail). */
export const MESHTASTIC_HYBRID_MQTT_PATH_TITLE =
  'Received via RF; some packets use an MQTT relay path';

/** Accessible name for the hybrid icon group in dense tables. */
export const MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL = 'RF and MQTT path';

export function MeshtasticRfPathIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-3 w-3 text-blue-400'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <title>RF</title>
      <path d="M5 12.55a11 11 0 0 1 14.08 0" />
      <path d="M1.42 9a16 16 0 0 1 21.16 0" />
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
      <circle cx="12" cy="20" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MeshtasticMqttPathIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className ?? 'h-3 w-3 text-purple-400'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={true}
    >
      <title>MQTT</title>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

export function MeshtasticHybridPathIcons({
  title = MESHTASTIC_HYBRID_MQTT_PATH_TITLE,
  ariaLabel = MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL,
  className,
}: {
  title?: string;
  ariaLabel?: string;
  /** Optional wrapper class (e.g. justify-center for table cells). */
  className?: string;
}) {
  return (
    <span
      role="img"
      className={`flex items-center justify-center gap-1 ${className ?? ''}`}
      title={title}
      aria-label={ariaLabel}
    >
      <MeshtasticRfPathIcon />
      <MeshtasticMqttPathIcon />
    </span>
  );
}
