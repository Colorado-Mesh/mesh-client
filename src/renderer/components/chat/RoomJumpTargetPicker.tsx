import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  buildRoomJumpCandidates,
  type RoomJumpCandidate,
  roomJumpTargetKey,
} from '@/renderer/lib/roomJumpCandidates';
import { loadRrcRecentRooms } from '@/renderer/lib/rrcRecentRooms';
import { resolveRrcHubDisplayLabel } from '@/renderer/lib/scheduledBroadcasts/channelLabel';
import type { RoomMacroTarget } from '@/renderer/stores/chatMacrosStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import { useNodeStore } from '@/renderer/stores/nodeStore';
import { useRrcHubStore } from '@/renderer/stores/rrcHubStore';
import { useRrcSessionStore } from '@/renderer/stores/rrcSessionStore';

export interface RoomJumpTargetPickerProps {
  value: RoomMacroTarget | null;
  onChange: (target: RoomMacroTarget | null) => void;
}

export function RoomJumpTargetPicker({ value, onChange }: RoomJumpTargetPickerProps) {
  const { t } = useTranslation();
  const identities = useIdentityStore((s) => s.identities);
  const nodesByIdentity = useNodeStore((s) => s.nodes);
  const rrcHubDestHash = useRrcSessionStore((s) => s.hubDestHash);
  const sessionsByHub = useRrcSessionStore((s) => s.sessionsByHub);
  const hubDisplayName = useRrcHubStore((s) =>
    rrcHubDestHash ? s.getHub(rrcHubDestHash)?.display_name : undefined,
  );

  const candidates = useMemo(() => {
    const rrcRoomsByHub = new Map<string, ReadonlyMap<string, unknown>>();
    for (const [hub, session] of sessionsByHub) {
      rrcRoomsByHub.set(hub, session.rooms);
    }
    const hub = rrcHubDestHash?.trim().toLowerCase() ?? null;
    return buildRoomJumpCandidates({
      identities,
      nodesByIdentity,
      rrcHubDestHash: hub,
      rrcRoomsByHub,
      rrcRecentRooms: hub ? loadRrcRecentRooms(hub) : [],
      rrcHubDisplayName: resolveRrcHubDisplayLabel(hub ?? undefined, hubDisplayName),
    });
  }, [identities, nodesByIdentity, rrcHubDestHash, sessionsByHub, hubDisplayName]);

  const selectedKey = value ? roomJumpTargetKey(value) : '';
  const selectedInList = candidates.some((c) => c.key === selectedKey);
  const meshcore = candidates.filter((c) => c.target.kind === 'meshcore-room');
  const rrc = candidates.filter((c) => c.target.kind === 'rrc-room');
  const empty = candidates.length === 0 && !value;

  const byKey = useMemo(() => {
    const map = new Map<string, RoomJumpCandidate>();
    for (const c of candidates) map.set(c.key, c);
    return map;
  }, [candidates]);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <select
        className="bg-ink-800 text-ink-100 rounded-control border-ink-600 text-body border px-2 py-1"
        value={selectedKey}
        aria-label={t('chatMacros.roomTargetLabel')}
        onChange={(e) => {
          const key = e.target.value;
          if (!key) {
            onChange(null);
            return;
          }
          const fromList = byKey.get(key);
          if (fromList) {
            onChange(fromList.target);
            return;
          }
          if (value && roomJumpTargetKey(value) === key) onChange(value);
        }}
      >
        <option value="">{t('chatMacros.roomPickerPlaceholder')}</option>
        {meshcore.length > 0 ? (
          <optgroup label={t('chatMacros.roomGroupMeshcore')}>
            {meshcore.map((c) => (
              <option key={c.key} value={c.key}>
                {c.target.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {rrc.length > 0 ? (
          <optgroup label={t('chatMacros.roomGroupRrc')}>
            {rrc.map((c) => (
              <option key={c.key} value={c.key}>
                {c.target.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {value && !selectedInList ? (
          <optgroup label={t('chatMacros.roomGroupSaved')}>
            <option value={selectedKey}>{value.label || selectedKey}</option>
          </optgroup>
        ) : null}
      </select>
      {empty ? <p className="text-label text-muted">{t('chatMacros.roomPickerEmpty')}</p> : null}
    </div>
  );
}
