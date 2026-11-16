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
import { useConnectionStore } from '@/renderer/stores/connectionStore';
import { useDeviceStore } from '@/renderer/stores/deviceStore';
import { useIdentityStore } from '@/renderer/stores/identityStore';
import { useLiveChannelKeyStore } from '@/renderer/stores/liveChannelKeyStore';
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
  const devices = useDeviceStore((s) => s.devices);
  const liveByProtocol = useLiveChannelKeyStore((s) => s.byProtocol);
  const connections = useConnectionStore((s) => s.connections);
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
    const connectedIdentityByProtocol: Partial<Record<'meshtastic' | 'meshcore', string | null>> =
      {};
    for (const identity of Object.values(identities)) {
      const protocol = identity.protocol.type;
      if (protocol !== 'meshtastic' && protocol !== 'meshcore') continue;
      const conn = connections[identity.id];
      if (!conn || (conn.status !== 'connected' && conn.status !== 'configured')) continue;
      // First live radio identity wins; dual-identity edge cases omit competing live maps.
      connectedIdentityByProtocol[protocol] ??= identity.id;
    }
    return buildRoomJumpCandidates({
      identities,
      nodesByIdentity,
      rrcHubDestHash: hub,
      rrcRoomsByHub,
      rrcRecentRooms: hub ? loadRrcRecentRooms(hub) : [],
      rrcHubDisplayName: resolveRrcHubDisplayLabel(hub ?? undefined, hubDisplayName),
      liveChannelKeysByProtocol: liveByProtocol,
      connectedIdentityByProtocol,
      devicesByIdentity: devices,
    });
  }, [
    identities,
    nodesByIdentity,
    rrcHubDestHash,
    sessionsByHub,
    hubDisplayName,
    liveByProtocol,
    connections,
    devices,
  ]);

  const selectedKey = value ? roomJumpTargetKey(value) : '';
  const selectedInList = candidates.some((c) => c.key === selectedKey);
  const meshcoreRooms = candidates.filter((c) => c.target.kind === 'meshcore-room');
  const chatChannels = candidates.filter(
    (c) => c.target.kind === 'meshcore-channel' || c.target.kind === 'meshtastic-channel',
  );
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
        {chatChannels.length > 0 ? (
          <optgroup label={t('chatMacros.roomGroupChatChannels')}>
            {chatChannels.map((c) => (
              <option key={c.key} value={c.key}>
                {c.target.label}
              </option>
            ))}
          </optgroup>
        ) : null}
        {meshcoreRooms.length > 0 ? (
          <optgroup label={t('chatMacros.roomGroupMeshcore')}>
            {meshcoreRooms.map((c) => (
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
