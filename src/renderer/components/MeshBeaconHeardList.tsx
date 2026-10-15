import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  findFreeChannelSlot,
  findJoinedChannel,
  type MeshtasticLoraSnapshot,
  planMeshBeaconLora,
} from '@/renderer/lib/meshtastic/meshBeaconJoin';
import { formatMeshtasticModuleApplyError } from '@/renderer/lib/meshtastic/meshtasticApplyErrorMessage';
import {
  meshtasticModemPresetLabel,
  meshtasticRegionLabel,
} from '@/renderer/lib/meshtastic/meshtasticEnumLabels';
import type { HeardMeshBeacon } from '@/renderer/lib/meshtastic/meshtasticModuleEvents';

import { ConfirmModal } from './ConfirmModal';
import type { MeshBeaconChannelConfig } from './MeshBeaconModuleSection';
import { formatTimeAgo } from './moduleConfigControls';
import { useToast } from './Toast';
import { buttonClassName } from './ui/Button';

interface Props {
  beacons: ReadonlyMap<number, HeardMeshBeacon>;
  getNodeName: (nodeNum: number) => string;
  channelConfigs: readonly MeshBeaconChannelConfig[];
  loraConfig: MeshtasticLoraSnapshot | null;
  disabled: boolean;
  /** False when configuring a remote node; joining only targets the connected radio. */
  canJoin: boolean;
  onJoinChannel: (slot: number, offer: { name: string; psk: Uint8Array }) => Promise<void>;
  onApplyLora: (overrides: Record<string, unknown>) => Promise<void>;
}

type PendingJoin =
  | { kind: 'channel'; nodeName: string; slot: number; offer: { name: string; psk: Uint8Array } }
  | { kind: 'lora'; overrides: Record<string, unknown>; changes: string };

export function MeshBeaconHeardList({
  beacons,
  getNodeName,
  channelConfigs,
  loraConfig,
  disabled,
  canJoin,
  onJoinChannel,
  onApplyLora,
}: Props) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const [pending, setPending] = useState<PendingJoin | null>(null);
  const [busy, setBusy] = useState(false);

  const list = [...beacons.values()].sort((a, b) => b.timestamp - a.timestamp);
  const freeSlot = findFreeChannelSlot(channelConfigs);

  const describeChanges = (overrides: Record<string, unknown>): string => {
    const parts: string[] = [];
    if (typeof overrides.region === 'number') {
      parts.push(
        t('modulePanel.beacon.changeRegion', { value: meshtasticRegionLabel(overrides.region, t) }),
      );
    }
    if (typeof overrides.modemPreset === 'number') {
      parts.push(
        t('modulePanel.beacon.changePreset', {
          value: meshtasticModemPresetLabel(overrides.modemPreset, t),
        }),
      );
    }
    if (typeof overrides.channelNum === 'number') {
      parts.push(
        overrides.channelNum > 0
          ? t('modulePanel.beacon.changeSlot', { value: overrides.channelNum })
          : t('modulePanel.beacon.changeSlotDerived'),
      );
    }
    return parts.join(', ');
  };

  const runPending = async (job: PendingJoin) => {
    setBusy(true);
    try {
      if (job.kind === 'channel') {
        await onJoinChannel(job.slot, job.offer);
        addToast(
          t('modulePanel.beacon.joined', {
            name: job.offer.name || t('modulePanel.beacon.unnamedChannel'),
          }),
          'success',
        );
      } else {
        await onApplyLora(job.overrides);
        addToast(t('modulePanel.beacon.radioApplied'), 'success');
      }
    } catch (err: unknown) {
      console.warn('[MeshBeaconHeardList] join failed ' + errLikeToLogString(err));
      addToast(
        t('modulePanel.beacon.joinFailed', { message: formatMeshtasticModuleApplyError(err, t) }),
        'error',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-ink-700 space-y-3 border-t pt-3">
      <h4 className="text-ink-300 text-sm font-medium">{t('modulePanel.beacon.heardTitle')}</h4>
      {!canJoin && <p className="text-muted text-xs">{t('modulePanel.beacon.remoteHint')}</p>}
      {list.length === 0 ? (
        <p className="text-muted text-xs">{t('modulePanel.beacon.none')}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => {
            const nodeName = getNodeName(b.from);
            const joinedIndex = b.offerChannel
              ? findJoinedChannel(channelConfigs, b.offerChannel)
              : null;
            const plan = planMeshBeaconLora(b, loraConfig);
            const channelName = b.offerChannel?.name || t('modulePanel.beacon.unnamedChannel');
            return (
              <li
                key={b.from}
                className="bg-ink-800/50 space-y-1 rounded px-3 py-2 text-xs"
                aria-label={t('modulePanel.beacon.itemAria', { name: nodeName })}
              >
                <div className="text-ink-300 flex justify-between gap-2">
                  <span className="font-medium">{nodeName}</span>
                  <span className="text-muted">{formatTimeAgo(b.timestamp, t)}</span>
                </div>
                {b.message !== '' && <p className="text-ink-200 break-words">{b.message}</p>}
                <ul className="text-muted space-y-0.5">
                  {b.offerChannel && (
                    <li>{t('modulePanel.beacon.offerChannel', { name: channelName })}</li>
                  )}
                  {b.offerRegion !== 0 && (
                    <li>
                      {t('modulePanel.beacon.offerRegion', {
                        region: meshtasticRegionLabel(b.offerRegion, t),
                      })}
                    </li>
                  )}
                  {b.offerPreset != null && (
                    <li>
                      {t('modulePanel.beacon.offerPreset', {
                        preset: meshtasticModemPresetLabel(b.offerPreset, t),
                      })}
                    </li>
                  )}
                  {b.offerFrequencySlot != null && (
                    <li>{t('modulePanel.beacon.offerSlot', { slot: b.offerFrequencySlot })}</li>
                  )}
                </ul>
                {canJoin && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {b.offerChannel &&
                      (joinedIndex != null ? (
                        <span className="text-green-400">
                          {t('modulePanel.beacon.alreadyJoined', { index: joinedIndex })}
                        </span>
                      ) : freeSlot == null ? (
                        <span className="text-orange-300">
                          {t('modulePanel.beacon.noFreeSlot')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className={buttonClassName('secondary', 'sm')}
                          disabled={disabled || busy}
                          aria-label={t('modulePanel.beacon.joinChannelAria', {
                            name: channelName,
                            node: nodeName,
                          })}
                          onClick={() => {
                            const offer = b.offerChannel;
                            if (!offer) return;
                            setPending({ kind: 'channel', nodeName, slot: freeSlot, offer });
                          }}
                        >
                          {t('modulePanel.beacon.joinChannel')}
                        </button>
                      ))}
                    {plan.kind === 'apply' && (
                      <button
                        type="button"
                        className={buttonClassName('secondary', 'sm')}
                        disabled={disabled || busy}
                        aria-label={t('modulePanel.beacon.applyRadioAria', { node: nodeName })}
                        onClick={() => {
                          setPending({
                            kind: 'lora',
                            overrides: plan.overrides,
                            changes: describeChanges(plan.overrides),
                          });
                        }}
                      >
                        {t('modulePanel.beacon.applyRadio')}
                      </button>
                    )}
                    {plan.kind === 'regionMismatch' && (
                      <span className="text-orange-300">
                        {t('modulePanel.beacon.regionMismatch', {
                          offer: meshtasticRegionLabel(plan.offerRegion, t),
                          local: meshtasticRegionLabel(plan.localRegion, t),
                        })}
                      </span>
                    )}
                    {plan.kind === 'alreadyMatching' && (
                      <span className="text-green-400">
                        {t('modulePanel.beacon.alreadyMatching')}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pending?.kind === 'channel' && (
        <ConfirmModal
          title={t('modulePanel.beacon.confirmChannelTitle')}
          message={t('modulePanel.beacon.confirmChannelMessage', {
            name: pending.offer.name || t('modulePanel.beacon.unnamedChannel'),
            slot: pending.slot,
            node: pending.nodeName,
          })}
          confirmLabel={t('modulePanel.beacon.confirmChannelLabel')}
          onConfirm={() => {
            const job = pending;
            setPending(null);
            void runPending(job);
          }}
          onCancel={() => {
            setPending(null);
          }}
        />
      )}
      {pending?.kind === 'lora' && (
        <ConfirmModal
          title={t('modulePanel.beacon.confirmRadioTitle')}
          message={t('modulePanel.beacon.confirmRadioMessage', { changes: pending.changes })}
          confirmLabel={t('modulePanel.beacon.confirmRadioLabel')}
          danger
          onConfirm={() => {
            const job = pending;
            setPending(null);
            void runPending(job);
          }}
          onCancel={() => {
            setPending(null);
          }}
        />
      )}
    </div>
  );
}
