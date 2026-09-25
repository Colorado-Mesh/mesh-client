import { useEffect, useRef, useState } from 'react';

import { MS_PER_MINUTE, MS_PER_SECOND } from '@/shared/timeConstants';

import {
  getOperationalAlertSettings,
  type OperationalAlertSettings,
} from '../lib/appSettingsStorage';
import { playMessageNotification } from '../lib/chatNotifications';
import i18n from '../lib/i18n';
import { normalizeLastHeardMs } from '../lib/nodeStatus';
import {
  shouldFireBatteryLow,
  shouldFireLinkDown,
  shouldFireSilenceEscalation,
} from '../lib/operationalAlerts';
import type { ProtocolCapabilities } from '../lib/radio/BaseRadioProvider';
import type { ConnectionStatus, MeshNode } from '../lib/types';
import { useWatchedNodesStore } from '../stores/watchedNodesStore';
import { fireNotification, notificationNodeName } from './useNodeStatusNotifier';
import { useNowMs } from './useNowMs';

/** Battery must recover this far above the threshold before a new low-battery alert can fire. */
export const BATTERY_ALERT_RESET_HYSTERESIS = 5;
/** Transient `disconnected` blips (power suspend, reconnect hand-off) settle within this window. */
export const LINK_DOWN_GRACE_MS = 5 * MS_PER_SECOND;
const SILENCE_TICK_MS = 30 * MS_PER_SECOND;

export interface OperationalLinkState {
  /** Stable key per RF link (e.g. protocol id). */
  key: string;
  /** Display label interpolated into the notification (brand name, not translated). */
  label: string;
  status: ConnectionStatus;
  /** Runtime flag: true when the drop was unexpected; false/undefined after manual disconnect. */
  connectionLoss?: boolean;
}

export interface UseOperationalAlertsArgs {
  nodes: Map<number, MeshNode>;
  capabilities: ProtocolCapabilities | null;
  links: readonly OperationalLinkState[];
  settings: OperationalAlertSettings;
}

function isLinkUp(status: ConnectionStatus): boolean {
  return status === 'connected' || status === 'configured' || status === 'stale';
}

function nodeDisplayName(node: MeshNode, capabilities: ProtocolCapabilities | null): string {
  return notificationNodeName(node, node.node_id, capabilities?.protocol);
}

/** App-settings slice for ops alerts; re-reads when App settings change. */
export function useOperationalAlertSettings(): OperationalAlertSettings {
  const [settings, setSettings] = useState(getOperationalAlertSettings);
  useEffect(() => {
    const sync = () => {
      setSettings(getOperationalAlertSettings());
    };
    window.addEventListener('mesh-client:appSettings', sync);
    return () => {
      window.removeEventListener('mesh-client:appSettings', sync);
    };
  }, []);
  return settings;
}

/**
 * EMCOMM ops alerts for watched nodes and RF links: low battery, silence escalation (2× the
 * user silence threshold; the first-level offline alert stays in `useNodeStatusNotifier`), and
 * unexpected link-down. Link-down never fires for a manual disconnect or while RF reconnect is
 * in progress (S10/S11); it fires once reconnect gives up and the link settles `disconnected`.
 */
export function useOperationalAlerts({
  nodes,
  capabilities,
  links,
  settings,
}: UseOperationalAlertsArgs): void {
  const watchedNodeIds = useWatchedNodesStore((s) => s.watchedNodeIds);
  const silenceMinutes = settings.nodeSilenceAlertMinutes;
  const silenceTick = useNowMs(silenceMinutes != null && watchedNodeIds.size > 0, SILENCE_TICK_MS);

  const batteryFiredRef = useRef<Set<number>>(new Set());
  const silenceFiredRef = useRef<Set<number>>(new Set());
  const linkWasUpRef = useRef<Map<string, boolean>>(new Map());
  const linkPrevStatusRef = useRef<Map<string, ConnectionStatus>>(new Map());
  const linkTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    const batteryFired = batteryFiredRef.current;
    const silenceFired = silenceFiredRef.current;
    const threshold = settings.nodeBatteryLowThreshold;
    const nowMs = Date.now();

    for (const id of batteryFired) if (!watchedNodeIds.has(id)) batteryFired.delete(id);
    for (const id of silenceFired) if (!watchedNodeIds.has(id)) silenceFired.delete(id);

    for (const nodeId of watchedNodeIds) {
      const node = nodes.get(nodeId);
      if (!node) continue;

      if (
        shouldFireBatteryLow({
          batteryPercent: node.battery,
          thresholdPercent: threshold,
          protocolHasBattery: capabilities?.hasBatteryTelemetry ?? false,
          alreadyFiredForCycle: batteryFired.has(nodeId),
        })
      ) {
        batteryFired.add(nodeId);
        fireNotification(
          i18n.t('operationalAlerts.batteryLowTitle', {
            name: nodeDisplayName(node, capabilities),
          }),
          i18n.t('operationalAlerts.batteryLowBody', { percent: node.battery }),
        );
        playMessageNotification('batteryLow');
      } else if (
        batteryFired.has(nodeId) &&
        node.battery > threshold + BATTERY_ALERT_RESET_HYSTERESIS
      ) {
        batteryFired.delete(nodeId);
      }

      if (silenceMinutes == null) continue;
      const lastHeardMs = normalizeLastHeardMs(node.last_heard) || null;
      const silenceOpts = {
        lastHeardMs,
        nowMs,
        thresholdMinutes: silenceMinutes,
        alreadyFiredForCycle: false,
      };
      if (!shouldFireSilenceEscalation(silenceOpts)) {
        silenceFired.delete(nodeId);
      } else if (!silenceFired.has(nodeId)) {
        silenceFired.add(nodeId);
        fireNotification(
          i18n.t('operationalAlerts.silenceEscalationTitle', {
            name: nodeDisplayName(node, capabilities),
          }),
          i18n.t('operationalAlerts.silenceEscalationBody', {
            minutes: Math.round((nowMs - (lastHeardMs ?? nowMs)) / MS_PER_MINUTE),
          }),
        );
        playMessageNotification('connectionLost');
      }
    }
  }, [
    nodes,
    watchedNodeIds,
    capabilities,
    settings.nodeBatteryLowThreshold,
    silenceMinutes,
    silenceTick,
  ]);

  useEffect(() => {
    const wasUp = linkWasUpRef.current;
    const prevStatus = linkPrevStatusRef.current;
    const timers = linkTimersRef.current;

    for (const link of links) {
      const previous = prevStatus.get(link.key);
      if (previous === link.status) continue;
      prevStatus.set(link.key, link.status);

      const pending = timers.get(link.key);
      if (pending !== undefined) {
        clearTimeout(pending);
        timers.delete(link.key);
      }

      if (isLinkUp(link.status)) {
        wasUp.set(link.key, true);
        continue;
      }
      const isReconnectInProgress = link.status === 'reconnecting' || link.status === 'connecting';
      // Keep the "was up" latch through reconnect attempts so exhaustion still alerts.
      if (isReconnectInProgress) continue;

      const fire = shouldFireLinkDown({
        wasConnected: wasUp.get(link.key) === true,
        isConnected: false,
        isManualDisconnect: link.connectionLoss !== true,
        isReconnectInProgress,
      });
      if (!fire || !settings.notifyOnLinkDown) {
        wasUp.set(link.key, false);
        continue;
      }

      const label = link.label;
      timers.set(
        link.key,
        setTimeout(() => {
          timers.delete(link.key);
          wasUp.set(link.key, false);
          fireNotification(
            i18n.t('operationalAlerts.linkDownTitle', { protocol: label }),
            i18n.t('operationalAlerts.linkDownBody'),
          );
          playMessageNotification('connectionLost');
        }, LINK_DOWN_GRACE_MS),
      );
    }
  }, [links, settings.notifyOnLinkDown]);

  useEffect(() => {
    const timers = linkTimersRef.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);
}
