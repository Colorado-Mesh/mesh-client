import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TAK_GEOCHAT_ROOM_MAX_LEN } from '@/shared/tak-types';

import type { IdentityId } from '../lib/types';
import { useDeviceStore } from '../stores/deviceStore';
import { useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';
import { CHECKBOX_CLASS, INPUT_BOX_SM_CLASS } from './ui/formClasses';

interface RoomInputProps {
  identityId: IdentityId;
  channel: number;
  channelName: string;
  saved: string;
}

/** Commits on blur or Enter so trimming does not fight typing. */
function RoomInput({ identityId, channel, channelName, saved }: RoomInputProps) {
  const { t } = useTranslation();
  const setChatBridge = useTakRelayPrefsStore((s) => s.setChatBridge);
  const [draft, setDraft] = useState(saved);
  const commit = () => {
    setChatBridge(identityId, channel, draft);
  };
  return (
    <input
      type="text"
      value={draft}
      maxLength={TAK_GEOCHAT_ROOM_MAX_LEN}
      spellCheck={false}
      placeholder={t('takServerPanel.channelRelayRoomPlaceholder')}
      aria-label={t('takServerPanel.channelRelayRoom', { channel: channelName })}
      onChange={(e) => {
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
      className={`${INPUT_BOX_SM_CLASS} w-40`}
    />
  );
}

interface Props {
  /** The MeshCore identity whose channels can feed TAK; channel slots are device-specific. */
  identityId: IdentityId | null;
}

const NO_CHANNELS: readonly { index: number; name: string }[] = [];

/**
 * Per-channel opt-ins for what a heard MeshCore channel feeds into TAK: `!MT1` tracker fixes as
 * markers and plain messages as a one-way GeoChat room. Only shown while a TAK sink is up.
 */
export default function TakChannelRelaySection({ identityId }: Props) {
  const { t } = useTranslation();
  const sinkActive = useTakSinkStore((s) => s.active);
  const channels = useDeviceStore((s) =>
    identityId ? (s.devices[identityId]?.meshcoreChannels ?? NO_CHANNELS) : NO_CHANNELS,
  );
  const prefs = useTakRelayPrefsStore((s) => (identityId ? s.byIdentity[identityId] : undefined));
  const setTrackerChannel = useTakRelayPrefsStore((s) => s.setTrackerChannel);

  if (!sinkActive || !identityId) return null;

  return (
    <div className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4">
      <h3 className="text-ink-300 text-sm font-medium">{t('takServerPanel.channelRelayTitle')}</h3>
      <p className="text-ink-400 text-xs">{t('takServerPanel.channelRelayDesc')}</p>
      {channels.length === 0 ? (
        <p className="text-muted text-xs">{t('takServerPanel.channelRelayNoChannels')}</p>
      ) : (
        <ul data-setting-anchor="tak.channelRelay.trackers" className="space-y-2">
          {channels.map((ch) => {
            const name = ch.name.trim() || t('takServerPanel.channelRelayUnnamed', { n: ch.index });
            const tracker = prefs?.trackerChannels.includes(ch.index) ?? false;
            const room = prefs?.chatBridges[ch.index] ?? '';
            const checkboxId = `tak-channel-relay-${identityId}-${ch.index}`;
            return (
              <li key={ch.index} className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-ink-200 min-w-24 font-medium">{name}</span>
                <label htmlFor={checkboxId} className="text-ink-300 flex items-center gap-1">
                  <input
                    id={checkboxId}
                    type="checkbox"
                    checked={tracker}
                    onChange={(e) => {
                      setTrackerChannel(identityId, ch.index, e.target.checked);
                    }}
                    className={CHECKBOX_CLASS}
                  />
                  {t('takServerPanel.channelRelayTrackers')}
                </label>
                <RoomInput
                  key={`${identityId}-${ch.index}-${room}`}
                  identityId={identityId}
                  channel={ch.index}
                  channelName={name}
                  saved={room}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
