import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SCHEDULED_BROADCAST_MAX_TARGETS } from '@/renderer/lib/scheduledBroadcasts/constants';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import { useLiveChannelKeyStore } from '@/renderer/stores/liveChannelKeyStore';
import { useNodeStore } from '@/renderer/stores/nodeStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';
import type { ScheduledBroadcastTarget } from '@/shared/scheduledBroadcastTypes';

const FALLBACK_CHANNEL_INDEXES = [0, 1, 2, 3, 4, 5, 6, 7] as const;

function targetKey(t: ScheduledBroadcastTarget): string {
  if (t.kind === 'meshtastic-channel' || t.kind === 'meshcore-channel') {
    if (t.channelKey) return `${t.kind}:${t.identityId}:key:${t.channelKey}`;
    return `${t.kind}:${t.identityId}:${t.channelIndex}`;
  }
  if (t.kind === 'meshcore-room') {
    return `${t.kind}:${t.identityId}:${t.roomPubKeyHex}`;
  }
  return `${t.kind}:${t.identityId}:${t.hubDestHash}:${t.room}`;
}

export interface ScheduledBroadcastTargetPickerProps {
  targets: ScheduledBroadcastTarget[];
  onChange: (targets: ScheduledBroadcastTarget[]) => void;
}

export function ScheduledBroadcastTargetPicker({
  targets,
  onChange,
}: ScheduledBroadcastTargetPickerProps) {
  const { t } = useTranslation();
  const identities = useIdentityStore((s) => s.identities);
  const nodesByIdentity = useNodeStore((s) => s.nodes);
  const liveByProtocol = useLiveChannelKeyStore((s) => s.byProtocol);
  const rrcHub = useRrcSessionStore((s) => s.hubDestHash);
  const rrcRooms = useRrcSessionStore((s) => s.rooms);
  const rrcIdentityId = useMemo(
    () => Object.values(identities).find((i) => i.protocol.type === 'reticulum')?.id,
    [identities],
  );

  const selected = useMemo(() => new Set(targets.map(targetKey)), [targets]);

  const toggle = (candidate: ScheduledBroadcastTarget) => {
    const key = targetKey(candidate);
    if (selected.has(key)) {
      onChange(targets.filter((x) => targetKey(x) !== key));
      return;
    }
    if (targets.length >= SCHEDULED_BROADCAST_MAX_TARGETS) return;
    onChange([...targets, { ...candidate, enabled: true }]);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-300 text-label">{t('scheduledBroadcasts.targetsHint')}</p>
      {Object.values(identities).map((identity) => {
        const protocolId = identity.protocol.type;
        if (protocolId !== 'meshtastic' && protocolId !== 'meshcore') return null;
        const kind = protocolId === 'meshtastic' ? 'meshtastic-channel' : 'meshcore-channel';
        const nodes = nodesByIdentity[identity.id] ?? {};
        const rooms =
          protocolId === 'meshcore'
            ? Object.values(nodes).filter((n) => n.hwModel === 'Room' && n.publicKeyHex)
            : [];
        const live = liveByProtocol[protocolId];
        const channelIndexes = live
          ? Object.keys(live.keyByIndex)
              .map(Number)
              .filter((n) => Number.isInteger(n) && n >= 0)
              .sort((a, b) => a - b)
          : [...FALLBACK_CHANNEL_INDEXES];
        return (
          <fieldset key={identity.id} className="border-ink-700 rounded-card border p-2">
            <legend className="text-ink-200 text-label px-1">
              {identity.displayName ?? identity.id.slice(0, 8)}
            </legend>
            <ul className="flex flex-col gap-1">
              {channelIndexes.map((channelIndex) => {
                const kindLabel =
                  kind === 'meshtastic-channel'
                    ? t('scheduledBroadcasts.targetKind.meshtasticChannel')
                    : t('scheduledBroadcasts.targetKind.meshcoreChannel');
                const channelKey = live?.keyByIndex[channelIndex];
                const candidate: ScheduledBroadcastTarget = {
                  kind,
                  identityId: identity.id,
                  label: `${kindLabel} ${channelIndex}`,
                  enabled: true,
                  channelIndex,
                  ...(channelKey ? { channelKey } : {}),
                };
                const key = targetKey(candidate);
                const id = `sb-target-${key}`;
                return (
                  <li key={key}>
                    <label htmlFor={id} className="text-label text-ink-100 flex items-center gap-2">
                      <input
                        id={id}
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => {
                          toggle(candidate);
                        }}
                        aria-label={candidate.label}
                      />
                      {candidate.label}
                    </label>
                  </li>
                );
              })}
              {rooms.map((room) => {
                const pub = room.publicKeyHex ?? '';
                if (!pub) return null;
                const candidate: ScheduledBroadcastTarget = {
                  kind: 'meshcore-room',
                  identityId: identity.id,
                  label: room.longName || room.shortName || pub.slice(0, 8),
                  enabled: true,
                  roomPubKeyHex: pub.toLowerCase(),
                  roomNodeId: room.nodeId,
                };
                const key = targetKey(candidate);
                const id = `sb-target-${key}`;
                return (
                  <li key={key}>
                    <label htmlFor={id} className="text-label text-ink-100 flex items-center gap-2">
                      <input
                        id={id}
                        type="checkbox"
                        checked={selected.has(key)}
                        onChange={() => {
                          toggle(candidate);
                        }}
                        aria-label={candidate.label}
                      />
                      {t('scheduledBroadcasts.targetKind.meshcoreRoom')}: {candidate.label}
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
      {rrcIdentityId && rrcHub ? (
        <fieldset className="border-ink-700 rounded-card border p-2">
          <legend className="text-ink-200 text-label px-1">
            {t('scheduledBroadcasts.targetKind.rrcRoom')}
          </legend>
          <ul className="flex flex-col gap-1">
            {[...rrcRooms.keys()].map((room) => {
              const candidate: ScheduledBroadcastTarget = {
                kind: 'rrc-room',
                identityId: rrcIdentityId,
                label: room,
                enabled: true,
                hubDestHash: rrcHub,
                room,
              };
              const key = targetKey(candidate);
              const id = `sb-target-${key}`;
              return (
                <li key={key}>
                  <label htmlFor={id} className="text-label text-ink-100 flex items-center gap-2">
                    <input
                      id={id}
                      type="checkbox"
                      checked={selected.has(key)}
                      onChange={() => {
                        toggle(candidate);
                      }}
                      aria-label={candidate.label}
                    />
                    {room}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}
