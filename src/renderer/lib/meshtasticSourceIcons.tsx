import { Globe, Wifi } from 'lucide-react-motion';

import { useIconTrigger } from '@/renderer/lib/icons/iconMotionContext';

import type { MeshNode } from './types';

/** True when the node is not MQTT-only and either session MQTT or packet via_mqtt applies. */
export function meshtasticNodeShowsHybridMqttPath(
  node: Pick<MeshNode, 'heard_via_mqtt' | 'heard_via_mqtt_only' | 'via_mqtt'>,
): boolean {
  if (node.heard_via_mqtt_only) return false;
  return Boolean(node.heard_via_mqtt) || Boolean(node.via_mqtt);
}

export type MeshtasticPathBadgeKind = 'none' | 'mqttOnly' | 'hybrid' | 'rfOnly';

export interface ResolveMeshtasticPathBadgeInput {
  node: Pick<MeshNode, 'heard_via_mqtt' | 'heard_via_mqtt_only' | 'via_mqtt'>;
  isSelf?: boolean;
  mqttConnected?: boolean;
  radioConnected?: boolean;
}

/** Resolves RF/MQTT path badge for list column and node detail (Meshtastic only). */
export function resolveMeshtasticPathBadge({
  node,
  isSelf = false,
  mqttConnected = false,
  radioConnected = false,
}: ResolveMeshtasticPathBadgeInput): MeshtasticPathBadgeKind {
  if (node.heard_via_mqtt_only) return 'mqttOnly';
  if (isSelf && mqttConnected && radioConnected) return 'hybrid';
  if (isSelf && mqttConnected) return 'mqttOnly';
  if (meshtasticNodeShowsHybridMqttPath(node)) return 'hybrid';
  if (isSelf && radioConnected) return 'rfOnly';
  return 'none';
}

/** Tooltip for hybrid RF + MQTT path (list column + node detail). */
export const MESHTASTIC_HYBRID_MQTT_PATH_TITLE =
  'Received via RF; some packets use an MQTT relay path';

/** Accessible name for the hybrid icon group in dense tables. */
export const MESHTASTIC_HYBRID_MQTT_PATH_ARIA_LABEL = 'RF and MQTT path';

export function MeshtasticRfPathIcon({ className }: { className?: string }) {
  const trigger = useIconTrigger();
  return (
    <Wifi
      aria-hidden
      className={className ?? 'h-3 w-3 text-blue-400'}
      trigger={trigger}
      size={12}
    />
  );
}

/** Sky (not purple) so the globe does not read as stale in the node list legend. */
export const MESHTASTIC_MQTT_PATH_ICON_CLASS = 'h-3 w-3 text-sky-400';

export function MeshtasticMqttPathIcon({ className }: { className?: string }) {
  const trigger = useIconTrigger();
  return (
    <Globe
      aria-hidden
      className={className ?? MESHTASTIC_MQTT_PATH_ICON_CLASS}
      trigger={trigger}
      size={12}
    />
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
      className={`inline-flex items-center justify-center gap-1 ${className ?? ''}`}
      title={title}
      aria-label={ariaLabel}
    >
      <MeshtasticRfPathIcon />
      <MeshtasticMqttPathIcon />
    </span>
  );
}

/** MQTT-only path badge (single globe, centered in the list column). */
export function MeshtasticMqttOnlyPathIcons({
  title,
  ariaLabel,
  className,
}: {
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <span
      role="img"
      className={`inline-flex items-center justify-center ${className ?? ''}`}
      title={title}
      aria-label={ariaLabel}
    >
      <MeshtasticMqttPathIcon />
    </span>
  );
}
