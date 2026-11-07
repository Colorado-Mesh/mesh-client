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

/**
 * Exact key match, or — when the live channel map is unavailable — match a saved keyed
 * channel target to a fallback slot candidate by identity + channelIndex so the same
 * channel cannot be added twice.
 */
function matchesCandidate(
  saved: ScheduledBroadcastTarget,
  candidate: ScheduledBroadcastTarget,
  liveUnavailable: boolean,
): boolean {
  if (targetKey(saved) === targetKey(candidate)) return true;
  if (!liveUnavailable) return false;
  if (
    (saved.kind !== 'meshtastic-channel' && saved.kind !== 'meshcore-channel') ||
    saved.kind !== candidate.kind
  ) {
    return false;
  }
  return (
    saved.identityId === candidate.identityId &&
    saved.channelIndex === candidate.channelIndex &&
    candidate.channelKey == null
  );
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

  const { candidates, liveUnavailableByIdentity } = useMemo(() => {
    const list: ScheduledBroadcastTarget[] = [];
    const liveUnavailable = new Map<string, boolean>();

    for (const identity of Object.values(identities)) {
      const protocolId = identity.protocol.type;
      if (protocolId !== 'meshtastic' && protocolId !== 'meshcore') continue;
      const kind = protocolId === 'meshtastic' ? 'meshtastic-channel' : 'meshcore-channel';
      const nodes = nodesByIdentity[identity.id] ?? {};
      const rooms =
        protocolId === 'meshcore'
          ? Object.values(nodes).filter((n) => n.hwModel === 'Room' && n.publicKeyHex)
          : [];
      const live = liveByProtocol[protocolId];
      const noLive = !live;
      liveUnavailable.set(identity.id, noLive);
      const channelIndexes = live
        ? Object.keys(live.keyByIndex)
            .map(Number)
            .filter((n) => Number.isInteger(n) && n >= 0)
            .sort((a, b) => a - b)
        : [...FALLBACK_CHANNEL_INDEXES];

      for (const channelIndex of channelIndexes) {
        const kindLabel =
          kind === 'meshtastic-channel'
            ? t('scheduledBroadcasts.targetKind.meshtasticChannel')
            : t('scheduledBroadcasts.targetKind.meshcoreChannel');
        const channelKey = live?.keyByIndex[channelIndex];
        list.push({
          kind,
          identityId: identity.id,
          label: `${kindLabel} ${channelIndex}`,
          enabled: true,
          channelIndex,
          ...(channelKey ? { channelKey } : {}),
        });
      }
      for (const room of rooms) {
        const pub = room.publicKeyHex ?? '';
        if (!pub) continue;
        list.push({
          kind: 'meshcore-room',
          identityId: identity.id,
          label: room.longName || room.shortName || pub.slice(0, 8),
          enabled: true,
          roomPubKeyHex: pub.toLowerCase(),
          roomNodeId: room.nodeId,
        });
      }
    }

    if (rrcIdentityId && rrcHub) {
      for (const room of rrcRooms.keys()) {
        list.push({
          kind: 'rrc-room',
          identityId: rrcIdentityId,
          label: room,
          enabled: true,
          hubDestHash: rrcHub,
          room,
        });
      }
    }

    return { candidates: list, liveUnavailableByIdentity: liveUnavailable };
  }, [identities, nodesByIdentity, liveByProtocol, rrcHub, rrcRooms, rrcIdentityId, t]);

  const isSelected = (candidate: ScheduledBroadcastTarget): boolean => {
    const liveUnavailable = liveUnavailableByIdentity.get(candidate.identityId) === true;
    return targets.some((saved) => matchesCandidate(saved, candidate, liveUnavailable));
  };

  const orphanTargets = useMemo(
    () =>
      targets.filter(
        (saved) =>
          !candidates.some((candidate) => {
            const liveUnavailable = liveUnavailableByIdentity.get(candidate.identityId) === true;
            return matchesCandidate(saved, candidate, liveUnavailable);
          }),
      ),
    [targets, candidates, liveUnavailableByIdentity],
  );

  const toggle = (candidate: ScheduledBroadcastTarget) => {
    const liveUnavailable = liveUnavailableByIdentity.get(candidate.identityId) === true;
    if (isSelected(candidate)) {
      onChange(targets.filter((x) => !matchesCandidate(x, candidate, liveUnavailable)));
      return;
    }
    if (targets.length >= SCHEDULED_BROADCAST_MAX_TARGETS) return;
    onChange([...targets, { ...candidate, enabled: true }]);
  };

  const removeSaved = (saved: ScheduledBroadcastTarget) => {
    const key = targetKey(saved);
    onChange(targets.filter((x) => targetKey(x) !== key));
  };

  const channelIdentities = Object.values(identities).filter(
    (identity) => identity.protocol.type === 'meshtastic' || identity.protocol.type === 'meshcore',
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink-300 text-label">{t('scheduledBroadcasts.targetsHint')}</p>
      {orphanTargets.length > 0 ? (
        <fieldset className="border-ink-700 rounded-card border p-2">
          <legend className="text-ink-200 text-label px-1">
            {t('scheduledBroadcasts.savedTargets')}
          </legend>
          <ul className="flex flex-col gap-1">
            {orphanTargets.map((saved) => {
              const key = targetKey(saved);
              const id = `sb-saved-${key}`;
              return (
                <li key={key}>
                  <label htmlFor={id} className="text-label text-ink-100 flex items-center gap-2">
                    <input
                      id={id}
                      type="checkbox"
                      checked
                      onChange={() => {
                        removeSaved(saved);
                      }}
                      aria-label={saved.label}
                    />
                    {saved.label}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>
      ) : null}
      {channelIdentities.map((identity) => {
        const protocolId = identity.protocol.type;
        if (protocolId !== 'meshtastic' && protocolId !== 'meshcore') return null;
        const identityCandidates = candidates.filter((c) => c.identityId === identity.id);
        if (identityCandidates.length === 0) return null;
        return (
          <fieldset key={identity.id} className="border-ink-700 rounded-card border p-2">
            <legend className="text-ink-200 text-label px-1">
              {identity.displayName ?? identity.id.slice(0, 8)}
            </legend>
            <ul className="flex flex-col gap-1">
              {identityCandidates.map((candidate) => {
                const key = targetKey(candidate);
                const id = `sb-target-${key}`;
                const roomPrefix =
                  candidate.kind === 'meshcore-room'
                    ? `${t('scheduledBroadcasts.targetKind.meshcoreRoom')}: `
                    : '';
                return (
                  <li key={key}>
                    <label htmlFor={id} className="text-label text-ink-100 flex items-center gap-2">
                      <input
                        id={id}
                        type="checkbox"
                        checked={isSelected(candidate)}
                        onChange={() => {
                          toggle(candidate);
                        }}
                        aria-label={candidate.label}
                      />
                      {roomPrefix}
                      {candidate.label}
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
            {candidates
              .filter((c) => c.kind === 'rrc-room')
              .map((candidate) => {
                const key = targetKey(candidate);
                const id = `sb-target-${key}`;
                return (
                  <li key={key}>
                    <label htmlFor={id} className="text-label text-ink-100 flex items-center gap-2">
                      <input
                        id={id}
                        type="checkbox"
                        checked={isSelected(candidate)}
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
          </ul>
        </fieldset>
      ) : null}
    </div>
  );
}
