import { Pencil, Trash2 } from 'lucide-react-motion';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { buttonClassName } from '@/renderer/components/ui/Button';
import type { ChatNotificationTarget } from '@/renderer/lib/chatDesktopNotifications';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useParentIconTrigger } from '@/renderer/lib/icons/iconMotionContext';
import type { MessagesByProtocol } from '@/renderer/lib/teamRoster/contactMessageHistory';
import { resolveMemberPresence } from '@/renderer/lib/teamRoster/contactPresence';
import { useTeamRosterLiveData } from '@/renderer/lib/teamRoster/useTeamRosterLiveData';
import { hydrateTeamRosterStore, useTeamRosterStore } from '@/renderer/stores/teamRosterStore';
import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember, TeamMemberLink } from '@/shared/teamRosterTypes';
import { rosterLinksOf } from '@/shared/teamRosterTypes';

import { TeamContactDetailDialog } from './TeamContactDetailDialog';
import { TeamContactEditorDialog } from './TeamContactEditorDialog';
import { TeamPresenceDot } from './TeamPresenceDot';
import { TEAM_PROTOCOL_LABEL_KEYS, TeamProtocolBadges } from './TeamProtocolBadges';
import { TeamRosterDevicePickerDialog } from './TeamRosterDevicePickerDialog';

const EMPTY_MESSAGES: MessagesByProtocol = {
  meshtastic: [],
  meshcore: [],
  reticulum: [],
};

export interface TeamContactsPanelProps {
  messagesByProtocol?: MessagesByProtocol;
  onOpenChat?: (target: ChatNotificationTarget) => void;
  onSendDm?: (args: {
    protocol: MeshProtocol;
    destination: number;
    reticulumHash?: string | null;
    text: string;
  }) => boolean | undefined;
}

/** Network panel: create/edit contact cards and manage protocol links. */
export default function TeamContactsPanel({
  messagesByProtocol = EMPTY_MESSAGES,
  onOpenChat,
  onSendDm,
}: TeamContactsPanelProps = {}) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const parentIconTrigger = useParentIconTrigger();
  const members = useTeamRosterStore((s) => s.members);
  const hydrated = useTeamRosterStore((s) => s.hydrated);
  const hydrateError = useTeamRosterStore((s) => s.hydrateError);
  const hydrateUnavailable = useTeamRosterStore((s) => s.hydrateUnavailable);
  const hydrate = useTeamRosterStore((s) => s.hydrate);
  const deleteMember = useTeamRosterStore((s) => s.deleteMember);
  const removeLink = useTeamRosterStore((s) => s.removeLink);
  const upsertMember = useTeamRosterStore((s) => s.upsertMember);
  const setLinkRoster = useTeamRosterStore((s) => s.setLinkRoster);
  const { nodesByProtocol, reticulumByHash } = useTeamRosterLiveData();
  const [editing, setEditing] = useState<TeamMember | null | undefined>(undefined);
  const [detailUnitId, setDetailUnitId] = useState<number | null>(null);
  const [rosterPickerMember, setRosterPickerMember] = useState<TeamMember | null>(null);

  useEffect(() => {
    if (!hydrated) void hydrate();
  }, [hydrated, hydrate]);

  const presenceByUnit = useMemo(() => {
    const map = new Map<number, ReturnType<typeof resolveMemberPresence>>();
    for (const member of members) {
      map.set(member.unitId, resolveMemberPresence(member, nodesByProtocol, reticulumByHash));
    }
    return map;
  }, [members, nodesByProtocol, reticulumByHash]);

  const detailMember = members.find((m) => m.unitId === detailUnitId) ?? null;
  const detailPresence = detailMember ? presenceByUnit.get(detailMember.unitId) : null;

  const handleDelete = async (member: TeamMember) => {
    if (!window.confirm(t('teamRoster.deleteConfirm'))) return;
    try {
      await deleteMember(member.unitId);
    } catch (err: unknown) {
      console.warn('[TeamContacts] delete failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.deleteFailed'), 'error');
    }
  };

  const handleUnlink = async (unitId: number, protocol: MeshProtocol, durableKey: string) => {
    try {
      await removeLink(unitId, protocol, durableKey);
    } catch (err: unknown) {
      console.warn('[TeamContacts] unlink failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.unlinkFailed'), 'error');
    }
  };

  const handleRemoveFromRoster = async (member: TeamMember) => {
    try {
      await upsertMember({
        unitId: member.unitId,
        callsign: member.callsign,
        isSelf: member.isSelf,
        onRoster: false,
      });
    } catch (err: unknown) {
      console.warn('[TeamContacts] roster clear failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
    }
  };

  const handleSyncRosterDevices = async (member: TeamMember, selected: TeamMemberLink[]) => {
    const selectedKeys = new Set(selected.map((l) => `${l.protocol}:${l.durableKey}`));
    try {
      for (const link of member.links) {
        const want = selectedKeys.has(`${link.protocol}:${link.durableKey}`);
        if (link.onRoster === want) continue;
        await setLinkRoster({
          unitId: member.unitId,
          protocol: link.protocol,
          durableKey: link.durableKey,
          onRoster: want,
        });
      }
    } catch (err: unknown) {
      console.warn('[TeamContacts] roster devices failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
      await hydrateTeamRosterStore();
      throw err;
    }
  };

  return (
    <section
      aria-labelledby="team-contacts-title"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id="team-contacts-title" className="text-ink-100 text-base font-semibold">
            {t('teamRoster.contactsTitle')}
          </h2>
          <p className="text-ink-300 text-label">{t('teamRoster.contactsIntro')}</p>
        </div>
        <button
          type="button"
          className={buttonClassName('primary', 'md')}
          aria-label={t('teamRoster.addContact')}
          onClick={() => {
            setEditing(null);
          }}
        >
          {t('teamRoster.addContact')}
        </button>
      </div>

      {hydrateError ? (
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-ink-400 text-label">
            {t(hydrateUnavailable ? 'teamRoster.loadUnavailable' : 'teamRoster.loadFailed')}
          </p>
          <button
            type="button"
            className={buttonClassName('secondary', 'sm')}
            aria-label={t('teamRoster.retryLoadAria')}
            onClick={() => {
              void hydrate();
            }}
          >
            {t('teamRoster.retryLoad')}
          </button>
        </div>
      ) : members.length === 0 ? (
        <p className="text-ink-400 text-label">{t('teamRoster.emptyContacts')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {members.map((member) => {
            const presence = presenceByUnit.get(member.unitId);
            const rosterCount = rosterLinksOf(member).length;
            return (
              <li
                key={member.unitId}
                className="border-ink-700 bg-ink-900/60 rounded-card flex flex-col gap-2 border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <button
                    type="button"
                    className="hover:bg-ink-800/80 min-w-0 flex-1 rounded-md p-1 text-start"
                    aria-label={t('teamRoster.openContactCard', { callsign: member.callsign })}
                    onClick={() => {
                      setDetailUnitId(member.unitId);
                    }}
                  >
                    <div className="text-ink-100 flex flex-wrap items-center gap-2 font-medium">
                      {presence ? <TeamPresenceDot status={presence.aggregateStatus} /> : null}
                      <span>
                        #{member.unitId} {member.callsign}
                      </span>
                      {member.isSelf ? (
                        <span className="rounded-badge bg-brand-green text-app-bg text-2xs px-1.5 py-0.5">
                          {t('teamRoster.selfBadge')}
                        </span>
                      ) : null}
                      {rosterCount > 0 ? (
                        <span className="rounded-badge bg-ink-700 text-ink-100 text-2xs px-1.5 py-0.5">
                          {t('teamRoster.rosterDeviceBadge', { count: rosterCount })}
                        </span>
                      ) : null}
                      {presence?.lastActive ? (
                        <span className="text-ink-400 text-label">
                          {t(TEAM_PROTOCOL_LABEL_KEYS[presence.lastActive.link.protocol])}
                        </span>
                      ) : null}
                    </div>
                    {member.role ? (
                      <p className="text-ink-300 text-label mt-0.5">{member.role}</p>
                    ) : null}
                  </button>
                  <div className="flex flex-wrap gap-1">
                    {rosterCount > 0 ? (
                      <>
                        <button
                          type="button"
                          className={buttonClassName('secondary', 'sm')}
                          aria-label={t('teamRoster.manageDevices')}
                          onClick={() => {
                            if (member.links.length === 0) {
                              addToast(t('teamRoster.devicePickerNeedLinks'), 'error');
                              return;
                            }
                            setRosterPickerMember(member);
                          }}
                        >
                          {t('teamRoster.manageDevices')}
                        </button>
                        <button
                          type="button"
                          className={buttonClassName('secondary', 'sm')}
                          aria-label={t('teamRoster.removeFromRosterAria')}
                          onClick={() => {
                            void handleRemoveFromRoster(member);
                          }}
                        >
                          {t('teamRoster.removeFromRoster')}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className={buttonClassName('secondary', 'sm')}
                        aria-label={t('teamRoster.addToRosterAria')}
                        onClick={() => {
                          if (member.links.length === 0) {
                            addToast(t('teamRoster.devicePickerNeedLinks'), 'error');
                            return;
                          }
                          setRosterPickerMember(member);
                        }}
                      >
                        {t('teamRoster.addToRoster')}
                      </button>
                    )}
                    <button
                      type="button"
                      className={buttonClassName('secondary', 'sm')}
                      aria-label={t('teamRoster.editContact')}
                      onClick={() => {
                        setEditing(member);
                      }}
                    >
                      <Pencil
                        className="h-4 w-4"
                        aria-hidden
                        trigger={parentIconTrigger}
                        size={16}
                      />
                    </button>
                    <button
                      type="button"
                      className={buttonClassName('danger', 'sm')}
                      aria-label={t('teamRoster.deleteContact')}
                      onClick={() => {
                        void handleDelete(member);
                      }}
                    >
                      <Trash2
                        className="h-4 w-4"
                        aria-hidden
                        trigger={parentIconTrigger}
                        size={16}
                      />
                    </button>
                  </div>
                </div>
                <TeamProtocolBadges links={member.links} />
                {member.links.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                    {member.links.map((link) => (
                      <li key={`${link.protocol}:${link.durableKey}`}>
                        <button
                          type="button"
                          className={buttonClassName('secondary', 'sm')}
                          aria-label={t('teamRoster.unlinkAria', {
                            protocol: t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol]),
                            name: link.longName?.trim() || link.durableKey,
                          })}
                          onClick={() => {
                            void handleUnlink(member.unitId, link.protocol, link.durableKey);
                          }}
                        >
                          {t('teamRoster.unlink', {
                            protocol: t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol]),
                          })}
                          {link.longName ? ` · ${link.longName}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {editing !== undefined ? (
        <TeamContactEditorDialog
          member={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      ) : null}

      {rosterPickerMember ? (
        <TeamRosterDevicePickerDialog
          member={rosterPickerMember}
          preselectRostered={rosterLinksOf(rosterPickerMember).length > 0}
          title={
            rosterLinksOf(rosterPickerMember).length > 0
              ? t('teamRoster.manageDevicesTitle')
              : t('teamRoster.selectDevicesTitle')
          }
          confirmLabel={t('teamRoster.confirmDevices')}
          onClose={() => {
            setRosterPickerMember(null);
          }}
          onConfirm={async (selected) => {
            await handleSyncRosterDevices(rosterPickerMember, selected);
          }}
        />
      ) : null}

      {detailMember && detailPresence ? (
        <TeamContactDetailDialog
          member={detailMember}
          presence={detailPresence}
          messagesByProtocol={messagesByProtocol}
          onClose={() => {
            setDetailUnitId(null);
          }}
          onOpenChat={onOpenChat ?? (() => {})}
          onSendDm={onSendDm}
        />
      ) : null}
    </section>
  );
}
