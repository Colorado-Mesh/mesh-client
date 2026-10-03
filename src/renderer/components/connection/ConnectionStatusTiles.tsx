import { Crosshair, Globe } from 'lucide-react-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ConnectionHeaderVariant,
  headerVariantDot,
  mqttHeaderVariant,
  takHeaderVariant,
} from '@/renderer/lib/connectionHeaderStatus';
import {
  connectionPanelMqttStatusLabel,
  connectionPanelTakRemoteLabel,
  connectionPanelTakStatusLabel,
} from '@/renderer/lib/connectionPanelLabels';
import { ICON_LG } from '@/renderer/lib/icons/iconClass';
import type { MQTTStatus } from '@/renderer/lib/types';
import type { TAKRemoteStatus } from '@/shared/tak-types';

import { Button } from '../ui/Button';
import { StatusTile } from '../ui/StatusTile';

/** Radio link (LoRa) or stack (Reticulum): the caller owns the wording. */
export interface ConnectionLinkTile {
  label: string;
  icon: ReactNode;
  status: string;
  variant: ConnectionHeaderVariant;
  detail?: string;
}

export interface ConnectionMqttSummary {
  status: MQTTStatus;
  connectionLoss?: boolean;
  /** `host:port` while connected or connecting. */
  server?: string;
}

export interface ConnectionTakSummary {
  running: boolean;
  port?: number;
  serverError: boolean;
  clientLoss: boolean;
  /** Remote TAK relay; folded into the same tile and dot as the local server. */
  remote?: Pick<TAKRemoteStatus, 'state' | 'error' | 'host' | 'port'>;
  /** Opens the TAK panel, where the server is configured and started. */
  onOpen?: () => void;
}

export interface ConnectionStatusTilesProps {
  link: ConnectionLinkTile;
  mqtt?: ConnectionMqttSummary;
  tak?: ConnectionTakSummary;
}

/**
 * Link tiles at the top of Connection (Option B): radio or stack, MQTT, TAK. The cards below carry
 * details and actions and do not repeat these states.
 */
export function ConnectionStatusTiles({ link, mqtt, tak }: ConnectionStatusTilesProps) {
  const { t } = useTranslation();
  const linkDot = headerVariantDot(link.variant);
  return (
    <div
      role="group"
      aria-label={t('connectionPanel.tiles.groupLabel')}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-3"
    >
      <StatusTile
        icon={link.icon}
        label={link.label}
        status={link.status}
        tone={linkDot.tone}
        pulse={linkDot.pulse}
        detail={link.detail}
      />
      {mqtt && <MqttTile summary={mqtt} />}
      {tak && <TakTile summary={tak} />}
    </div>
  );
}

function MqttTile({ summary }: { summary: ConnectionMqttSummary }) {
  const { t } = useTranslation();
  const loss = summary.connectionLoss ?? false;
  const dot = headerVariantDot(mqttHeaderVariant(summary.status, loss));
  return (
    <StatusTile
      icon={<Globe aria-hidden className={ICON_LG} size={20} />}
      label={t('connectionPanel.tiles.mqtt')}
      status={connectionPanelMqttStatusLabel(t, summary.status, loss)}
      tone={dot.tone}
      pulse={dot.pulse}
      detail={summary.server}
    />
  );
}

function TakTile({ summary }: { summary: ConnectionTakSummary }) {
  const { t } = useTranslation();
  const { remote } = summary;
  const dot = headerVariantDot(
    takHeaderVariant(summary.running, summary.serverError, summary.clientLoss, remote),
  );
  const localStatus = connectionPanelTakStatusLabel(
    t,
    summary.running,
    summary.serverError,
    summary.clientLoss,
  );
  const remoteLabel = remote ? connectionPanelTakRemoteLabel(t, remote) : null;
  const remoteHost = remote ? `${remote.host}:${remote.port}` : '';
  const detailParts: string[] = [];
  if (summary.running && summary.port) {
    detailParts.push(t('connectionPanel.tiles.takPort', { port: summary.port }));
  }
  if (remoteLabel) {
    detailParts.push(
      summary.running
        ? t('connectionPanel.tiles.takRemoteWithHost', { state: remoteLabel, host: remoteHost })
        : remoteHost,
    );
  }
  return (
    <StatusTile
      icon={<Crosshair aria-hidden className={ICON_LG} size={20} />}
      label={t('connectionPanel.tiles.tak')}
      status={!summary.running && remoteLabel ? remoteLabel : localStatus}
      tone={dot.tone}
      pulse={dot.pulse}
      detail={detailParts.length > 0 ? detailParts.join(' · ') : undefined}
      action={
        summary.onOpen ? (
          <Button size="sm" onClick={summary.onOpen}>
            {t('connectionPanel.tiles.openTak')}
          </Button>
        ) : undefined
      }
    />
  );
}
