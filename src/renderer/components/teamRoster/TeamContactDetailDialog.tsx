import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buttonClassName } from '@/renderer/components/ui/Button';
import { INPUT_CLASS } from '@/renderer/components/ui/formClasses';
import type { ChatNotificationTarget } from '@/renderer/lib/chatDesktopNotifications';
import {
  buildContactMessageTimeline,
  dmPeerFromPresence,
  type MessagesByProtocol,
  reticulumHashFromLink,
} from '@/renderer/lib/teamRoster/contactMessageHistory';
import type { MemberPresenceSnapshot } from '@/renderer/lib/teamRoster/contactPresence';
import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember } from '@/shared/teamRosterTypes';

import { TeamPresenceDot } from './TeamPresenceDot';
import { TEAM_PROTOCOL_LABEL_KEYS } from './TeamProtocolBadges';

export interface TeamContactDetailDialogProps {
  member: TeamMember;
  presence: MemberPresenceSnapshot;
  messagesByProtocol: MessagesByProtocol;
  onClose: () => void;
  onOpenChat: (target: ChatNotificationTarget) => void;
  /** Optional: send a DM without leaving the dialog (uses last-active / picker). */
  onSendDm?: (args: {
    protocol: MeshProtocol;
    destination: number;
    reticulumHash?: string | null;
    text: string;
  }) => boolean | undefined;
}

function formatTime(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    // catch-no-log-ok Invalid Date / locale edge — fall back to numeric timestamp
    return String(ts);
  }
}

export function TeamContactDetailDialog({
  member,
  presence,
  messagesByProtocol,
  onClose,
  onOpenChat,
  onSendDm,
}: TeamContactDetailDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const timeline = useMemo(
    () => buildContactMessageTimeline(presence.links, messagesByProtocol),
    [presence.links, messagesByProtocol],
  );
  const defaultLinkKey = presence.lastActive
    ? `${presence.lastActive.link.protocol}:${presence.lastActive.link.durableKey}`
    : presence.links[0]
      ? `${presence.links[0].link.protocol}:${presence.links[0].link.durableKey}`
      : '';
  const [linkKey, setLinkKey] = useState(defaultLinkKey);
  const [draft, setDraft] = useState('');
  const selected =
    presence.links.find((s) => `${s.link.protocol}:${s.link.durableKey}` === linkKey) ??
    presence.lastActive ??
    presence.links[0] ??
    null;

  const openSelectedChat = () => {
    if (!selected) return;
    const peer = dmPeerFromPresence(selected);
    const hash = reticulumHashFromLink(selected.link);
    if (peer == null && !hash) return;
    onOpenChat({
      kind: 'chat',
      protocol: selected.link.protocol,
      dmPeer: peer,
      channel: null,
    });
    onClose();
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !selected || !onSendDm) return;
    const peer = dmPeerFromPresence(selected);
    if (peer == null) return;
    const ok = onSendDm({
      protocol: selected.link.protocol,
      destination: peer,
      reticulumHash: reticulumHashFromLink(selected.link),
      text,
    });
    if (ok !== false) setDraft('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-ink-600 bg-ink-900 rounded-modal shadow-level-3 flex max-h-[90vh] w-full max-w-lg flex-col border"
      >
        <div className="border-ink-700 flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-ink-100 flex flex-wrap items-center gap-2 text-base font-semibold"
            >
              <TeamPresenceDot status={presence.aggregateStatus} />
              <span>
                #{member.unitId} {member.callsign}
              </span>
              {member.isSelf ? (
                <span className="rounded-badge bg-brand-green text-app-bg text-2xs px-1.5 py-0.5">
                  {t('teamRoster.selfBadge')}
                </span>
              ) : null}
            </h2>
            {member.role ? <p className="text-ink-300 text-label mt-1">{member.role}</p> : null}
            {presence.lastActive ? (
              <p className="text-ink-400 text-label mt-1">
                {t('teamRoster.lastActiveProtocol', {
                  protocol: t(TEAM_PROTOCOL_LABEL_KEYS[presence.lastActive.link.protocol]),
                })}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className={buttonClassName('secondary', 'sm')}
            aria-label={t('aria.closeDialog')}
            onClick={onClose}
          >
            {t('common.close')}
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section aria-labelledby={`${titleId}-links`}>
            <h3 id={`${titleId}-links`} className="text-ink-200 mb-2 text-sm font-medium">
              {t('teamRoster.linkedProtocols')}
            </h3>
            {presence.links.length === 0 ? (
              <p className="text-ink-400 text-label">{t('teamRoster.noLinks')}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {presence.links.map((snap) => (
                  <li
                    key={`${snap.link.protocol}:${snap.link.durableKey}`}
                    className="border-ink-800 flex items-center gap-2 rounded border px-2 py-1.5 text-sm"
                  >
                    <TeamPresenceDot status={snap.status} />
                    <span className="text-ink-100 min-w-0 flex-1 truncate">
                      {t(TEAM_PROTOCOL_LABEL_KEYS[snap.link.protocol])}
                      {snap.displayName ? ` · ${snap.displayName}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby={`${titleId}-history`}>
            <h3 id={`${titleId}-history`} className="text-ink-200 mb-2 text-sm font-medium">
              {t('teamRoster.messageHistory')}
            </h3>
            {timeline.length === 0 ? (
              <p className="text-ink-400 text-label">{t('teamRoster.emptyMessageHistory')}</p>
            ) : (
              <ul className="border-ink-700 max-h-48 overflow-y-auto rounded border">
                {timeline.map((item) => (
                  <li key={item.key}>
                    <button
                      type="button"
                      className="hover:bg-ink-800 w-full px-3 py-2 text-left text-sm"
                      aria-label={t('teamRoster.openMessageInChat')}
                      onClick={() => {
                        if (item.isDirectMessage && item.dmPeer != null) {
                          onOpenChat({
                            kind: 'chat',
                            protocol: item.protocol,
                            dmPeer: item.dmPeer,
                            channel: null,
                          });
                        } else if (item.channel != null) {
                          onOpenChat({
                            kind: 'chat',
                            protocol: item.protocol,
                            dmPeer: null,
                            channel: item.channel,
                          });
                        } else if (item.reticulumPeerHash) {
                          onOpenChat({
                            kind: 'chat',
                            protocol: item.protocol,
                            dmPeer: item.dmPeer,
                            channel: null,
                          });
                        }
                        onClose();
                      }}
                    >
                      <span className="text-ink-400 text-label block">
                        {formatTime(item.message.timestamp)} ·{' '}
                        {t(TEAM_PROTOCOL_LABEL_KEYS[item.protocol])}
                      </span>
                      <span className="text-ink-100 line-clamp-2">
                        {item.message.sender_name}: {item.message.payload}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {presence.links.length > 0 ? (
            <section aria-labelledby={`${titleId}-compose`} className="flex flex-col gap-2">
              <h3 id={`${titleId}-compose`} className="text-ink-200 text-sm font-medium">
                {t('teamRoster.messageContact')}
              </h3>
              <label className="flex flex-col gap-1">
                <span className="text-ink-300 text-label">{t('teamRoster.sendViaProtocol')}</span>
                <select
                  className={INPUT_CLASS}
                  value={linkKey}
                  aria-label={t('teamRoster.sendViaProtocol')}
                  onChange={(e) => {
                    setLinkKey(e.target.value);
                  }}
                >
                  {presence.links.map((snap) => (
                    <option
                      key={`${snap.link.protocol}:${snap.link.durableKey}`}
                      value={`${snap.link.protocol}:${snap.link.durableKey}`}
                    >
                      {t(TEAM_PROTOCOL_LABEL_KEYS[snap.link.protocol])}
                      {snap.displayName ? ` — ${snap.displayName}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              {onSendDm ? (
                <>
                  <textarea
                    className={`${INPUT_CLASS} min-h-[4.5rem]`}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                    }}
                    aria-label={t('teamRoster.composeAria')}
                    placeholder={t('teamRoster.composePlaceholder')}
                  />
                  <div className="flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      className={buttonClassName('secondary', 'md')}
                      onClick={openSelectedChat}
                    >
                      {t('teamRoster.openInChat')}
                    </button>
                    <button
                      type="button"
                      className={buttonClassName('primary', 'md')}
                      disabled={
                        !draft.trim() || selected == null || dmPeerFromPresence(selected) == null
                      }
                      onClick={handleSend}
                    >
                      {t('teamRoster.sendMessage')}
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className={buttonClassName('primary', 'md')}
                  disabled={selected == null || dmPeerFromPresence(selected) == null}
                  onClick={openSelectedChat}
                >
                  {t('teamRoster.openInChat')}
                </button>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
