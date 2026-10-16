import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TAK_GEOCHAT_ROOM_MAX_LEN } from '@/shared/tak-types';

import type { IdentityId } from '../lib/types';
import { type TakChannelInfo, useTakChannelStore } from '../stores/takChannelStore';
import { type TakChannelMode, useTakRelayPrefsStore } from '../stores/takRelayPrefsStore';
import { useTakSinkStore } from '../stores/takSinkStore';
import { CHECKBOX_CLASS, INPUT_BOX_SM_CLASS, SELECT_BOX_SM_CLASS } from './ui/formClasses';

const NO_CHANNELS: readonly TakChannelInfo[] = [];

const MODE_LABEL_KEYS: Record<TakChannelMode, string> = {
  off: 'takServerPanel.channelModeOff',
  all: 'takServerPanel.channelModeAll',
  selected: 'takServerPanel.channelModeSelected',
};

interface CheckProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  ariaLabel: string;
}

/** A small labelled checkbox in a channel row. */
function RowCheck({ id, checked, onChange, label, ariaLabel }: CheckProps) {
  return (
    <label htmlFor={id} className="text-ink-300 flex items-center gap-1">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
        aria-label={ariaLabel}
        className={CHECKBOX_CLASS}
      />
      {label}
    </label>
  );
}

interface NameFieldProps {
  id: string;
  /** The name the user chose, or empty for the automatic one. */
  saved: string;
  /** The automatic name, shown while the field is empty. */
  automatic: string;
  onSave: (name: string) => void;
  ariaLabel: string;
  label: string;
}

/**
 * The name a channel's contact gets in ATAK. Saved when the field loses focus or on Enter, not
 * per keystroke, since each change is sent to every ATAK device; Escape puts the saved name
 * back, and an emptied field goes back to the automatic name.
 */
function AtakNameField({ id, saved, automatic, onSave, ariaLabel, label }: NameFieldProps) {
  const [draft, setDraft] = useState(saved);
  const [shownSaved, setShownSaved] = useState(saved);
  if (saved !== shownSaved) {
    setShownSaved(saved);
    setDraft(saved);
  }
  return (
    <label htmlFor={id} className="text-ink-300 flex items-center gap-1">
      {label}
      <input
        id={id}
        type="text"
        value={draft}
        placeholder={automatic}
        maxLength={TAK_GEOCHAT_ROOM_MAX_LEN}
        spellCheck={false}
        onChange={(e) => {
          setDraft(e.target.value);
        }}
        onBlur={() => {
          if (draft.trim() !== saved) onSave(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') setDraft(saved);
        }}
        aria-label={ariaLabel}
        className={`${INPUT_BOX_SM_CLASS} w-40`}
      />
    </label>
  );
}

interface Props {
  /** The radio whose channels can feed TAK; channel slots are device-specific. */
  identityId: IdentityId | null;
  /** Offer the `!MT1` tracker-fix checkbox (protocol capability `hasTakTrackerChannels`). */
  showTrackers: boolean;
  title: string;
  description: string;
  emptyText: string;
  /** Settings search anchor for the section. */
  anchorId: string;
  /** Shown at the end of the section: the radio's direct message switch. */
  children?: ReactNode;
}

/**
 * One radio's messaging in ATAK: which channels become contacts (off, all, or selected ones),
 * and for each served channel whether TAK devices may send to it and whether it streams to the
 * remote server; the per-channel `!MT1` tracker opt-in when supported; and whether TAK devices
 * may message the radio's companions. Only shown while a TAK sink is up.
 */
export default function TakChannelRelaySection({
  identityId,
  showTrackers,
  title,
  description,
  emptyText,
  anchorId,
  children,
}: Props) {
  const { t } = useTranslation();
  const sinkActive = useTakSinkStore((s) => s.active);
  const channels = useTakChannelStore((s) =>
    identityId ? (s.channelsByIdentity[identityId] ?? NO_CHANNELS) : NO_CHANNELS,
  );
  const prefs = useTakRelayPrefsStore((s) => (identityId ? s.byIdentity[identityId] : undefined));
  const setTrackerChannel = useTakRelayPrefsStore((s) => s.setTrackerChannel);
  const setChannelMode = useTakRelayPrefsStore((s) => s.setChannelMode);
  const setChatChannel = useTakRelayPrefsStore((s) => s.setChatChannel);
  const setChatSend = useTakRelayPrefsStore((s) => s.setChatSend);
  const setChatRemote = useTakRelayPrefsStore((s) => s.setChatRemote);
  const setAtakName = useTakRelayPrefsStore((s) => s.setAtakName);
  if (!sinkActive || !identityId) return null;

  const mode = prefs?.channelMode ?? 'off';
  const modeId = `tak-channel-mode-${identityId}`;
  const showList = channels.length > 0 && (mode !== 'off' || showTrackers);

  return (
    <div
      data-setting-anchor={anchorId}
      className="bg-deep-black border-ink-800 space-y-3 rounded-xl border p-4"
    >
      <h3 className="text-ink-300 text-sm font-medium">{title}</h3>
      <p className="text-ink-400 text-xs">{description}</p>
      {channels.length === 0 ? (
        <p className="text-muted text-xs">{emptyText}</p>
      ) : (
        <div className="flex items-center gap-2 text-xs">
          <label htmlFor={modeId} className="text-ink-300">
            {t('takServerPanel.channelModeLabel')}
          </label>
          <select
            id={modeId}
            value={mode}
            onChange={(e) => {
              setChannelMode(identityId, e.target.value as TakChannelMode);
            }}
            className={SELECT_BOX_SM_CLASS}
          >
            {(Object.keys(MODE_LABEL_KEYS) as TakChannelMode[]).map((m) => (
              <option key={m} value={m}>
                {t(MODE_LABEL_KEYS[m])}
              </option>
            ))}
          </select>
        </div>
      )}
      {showList && (
        <ul className="space-y-2">
          {channels.map((ch) => {
            const name = ch.name || t('takServerPanel.channelRelayUnnamed', { n: ch.index });
            const picked = prefs?.chatChannels.includes(ch.key) ?? false;
            const served = mode === 'all' || (mode === 'selected' && picked);
            const rowId = `tak-channel-${identityId}-${ch.index}`;
            return (
              <li key={ch.key} className="flex flex-wrap items-center gap-3 text-xs">
                <span className="text-ink-200 min-w-24 font-medium">{name}</span>
                {mode === 'selected' && (
                  <RowCheck
                    id={`${rowId}-serve`}
                    checked={picked}
                    onChange={(on) => {
                      setChatChannel(identityId, ch.key, on);
                    }}
                    label={t('takServerPanel.channelServe')}
                    ariaLabel={t('takServerPanel.channelServeFor', { channel: name })}
                  />
                )}
                {served && (
                  <>
                    <AtakNameField
                      id={`${rowId}-name`}
                      saved={prefs?.atakNames[ch.key] ?? ''}
                      automatic={ch.atakName}
                      onSave={(atakName) => {
                        setAtakName(identityId, ch.key, atakName);
                      }}
                      label={t('takServerPanel.channelAtakNameLabel')}
                      ariaLabel={t('takServerPanel.channelAtakNameFor', { channel: name })}
                    />
                    <RowCheck
                      id={`${rowId}-send`}
                      checked={prefs?.sendChannels.includes(ch.key) ?? false}
                      onChange={(on) => {
                        setChatSend(identityId, ch.key, on);
                      }}
                      label={t('takServerPanel.channelSend')}
                      ariaLabel={t('takServerPanel.channelSendFor', { channel: name })}
                    />
                    <RowCheck
                      id={`${rowId}-remote`}
                      checked={prefs?.remoteChannels.includes(ch.key) ?? false}
                      onChange={(on) => {
                        setChatRemote(identityId, ch.key, on);
                      }}
                      label={t('takServerPanel.channelRemote')}
                      ariaLabel={t('takServerPanel.channelRemoteFor', { channel: name })}
                    />
                  </>
                )}
                {showTrackers && (
                  <RowCheck
                    id={`${rowId}-tracker`}
                    checked={prefs?.trackerChannels.includes(ch.index) ?? false}
                    onChange={(on) => {
                      setTrackerChannel(identityId, ch.index, on);
                    }}
                    label={t('takServerPanel.channelRelayTrackers')}
                    ariaLabel={t('takServerPanel.channelTrackersFor', { channel: name })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
      {children}
    </div>
  );
}

interface DirectMessagesProps {
  identityId: IdentityId | null;
  /** Settings search anchor for the switch. */
  anchorId: string;
}

/** The switch letting TAK devices message one radio's companions; shown inside its section. */
export function TakDirectMessagesToggle({ identityId, anchorId }: DirectMessagesProps) {
  const { t } = useTranslation();
  const enabled = useTakRelayPrefsStore((s) =>
    identityId ? (s.byIdentity[identityId]?.directMessages ?? false) : false,
  );
  const setDirectMessages = useTakRelayPrefsStore((s) => s.setDirectMessages);
  if (!identityId) return null;
  const id = `tak-direct-messages-${identityId}`;
  return (
    <div data-setting-anchor={anchorId} className="space-y-1 text-xs">
      <label htmlFor={id} className="text-ink-300 flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setDirectMessages(identityId, e.target.checked);
          }}
          aria-describedby={`${id}-hint`}
          className={CHECKBOX_CLASS}
        />
        {t('takServerPanel.directMessages')}
      </label>
      <p id={`${id}-hint`} className="text-ink-400">
        {t('takServerPanel.directMessagesHint')}
      </p>
    </div>
  );
}
