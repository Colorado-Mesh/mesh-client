import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { buttonClassName } from '@/renderer/components/ui/Button';
import { INPUT_CLASS } from '@/renderer/components/ui/formClasses';
import type { ChatNotificationTarget } from '@/renderer/lib/chatDesktopNotifications';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { MessagesByProtocol } from '@/renderer/lib/teamRoster/contactMessageHistory';
import {
  type MemberPresenceSnapshot,
  resolveMemberPresence,
} from '@/renderer/lib/teamRoster/contactPresence';
import { fanOutTeamMessage } from '@/renderer/lib/teamRoster/teamMessageFanOut';
import { useTeamRosterLiveData } from '@/renderer/lib/teamRoster/useTeamRosterLiveData';
import { useTeamRosterStore } from '@/renderer/stores/teamRosterStore';
import type { MeshProtocol } from '@/shared/meshProtocol';
import type { TeamMember, TeamMemberLink } from '@/shared/teamRosterTypes';
import { rosterLinksOf } from '@/shared/teamRosterTypes';

import { TeamContactDetailDialog } from './TeamContactDetailDialog';
import { TeamContactEditorDialog } from './TeamContactEditorDialog';
import { TeamPresenceDot } from './TeamPresenceDot';
import { TEAM_PROTOCOL_LABEL_KEYS } from './TeamProtocolBadges';
import { TeamRosterDevicePickerDialog } from './TeamRosterDevicePickerDialog';

const EMPTY_MESSAGES: MessagesByProtocol = {
  meshtastic: [],
  meshcore: [],
  reticulum: [],
};

export interface TeamRosterPanelProps {
  messagesByProtocol?: MessagesByProtocol;
  onOpenChat?: (target: ChatNotificationTarget) => void;
  onSendDm?: (args: {
    protocol: MeshProtocol;
    destination: number;
    reticulumHash?: string | null;
    text: string;
  }) => boolean | undefined;
}

type DevicePickerState =
  | { mode: 'add'; member: TeamMember }
  | { mode: 'manage'; member: TeamMember }
  | { mode: 'addDevices'; member: TeamMember };

/** Network panel: volunteer ops roster with presence and team fan-out messaging. */
export default function TeamRosterPanel({
  messagesByProtocol = EMPTY_MESSAGES,
  onOpenChat,
  onSendDm,
}: TeamRosterPanelProps = {}) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const members = useTeamRosterStore((s) => s.members);
  const upsertMember = useTeamRosterStore((s) => s.upsertMember);
  const setLinkRoster = useTeamRosterStore((s) => s.setLinkRoster);
  const { nodesByProtocol, reticulumByHash } = useTeamRosterLiveData();
  const rosterMembers = useMemo(() => members.filter((m) => m.onRoster), [members]);
  const offRosterMembers = useMemo(() => members.filter((m) => !m.onRoster), [members]);
  const presenceByUnit = useMemo(() => {
    const map = new Map<number, MemberPresenceSnapshot>();
    for (const member of rosterMembers) {
      map.set(
        member.unitId,
        resolveMemberPresence(member, nodesByProtocol, reticulumByHash, {
          rosterLinksOnly: true,
        }),
      );
    }
    return map;
  }, [rosterMembers, nodesByProtocol, reticulumByHash]);
  /** Full-card presence for Contact Card detail opened from roster. */
  const detailPresenceByUnit = useMemo(() => {
    const map = new Map<number, MemberPresenceSnapshot>();
    for (const member of members) {
      map.set(member.unitId, resolveMemberPresence(member, nodesByProtocol, reticulumByHash));
    }
    return map;
  }, [members, nodesByProtocol, reticulumByHash]);

  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [devicePicker, setDevicePicker] = useState<DevicePickerState | null>(null);
  const [creating, setCreating] = useState(false);
  const [busyUnitId, setBusyUnitId] = useState<number | null>(null);
  const [detailUnitId, setDetailUnitId] = useState<number | null>(null);
  const [selectedUnitIds, setSelectedUnitIds] = useState<Set<number>>(() => new Set());
  const [teamDraft, setTeamDraft] = useState('');
  const [fanOutBusy, setFanOutBusy] = useState(false);
  const cardPickerTitleId = useId();

  const detailMember = members.find((m) => m.unitId === detailUnitId) ?? null;
  const detailPresence = detailMember ? detailPresenceByUnit.get(detailMember.unitId) : null;

  const applyRosterDevices = async (
    member: TeamMember,
    selected: TeamMemberLink[],
    mode: DevicePickerState['mode'],
  ) => {
    setBusyUnitId(member.unitId);
    try {
      if (mode === 'manage') {
        const selectedKeys = new Set(selected.map((l) => `${l.protocol}:${l.durableKey}`));
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
      } else {
        for (const link of selected) {
          await setLinkRoster({
            unitId: member.unitId,
            protocol: link.protocol,
            durableKey: link.durableKey,
            onRoster: true,
          });
        }
      }
    } catch (err: unknown) {
      console.warn('[TeamRoster] device select failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
      throw err;
    } finally {
      setBusyUnitId(null);
    }
  };

  const removeDeviceFromRoster = async (member: TeamMember, link: TeamMemberLink) => {
    setBusyUnitId(member.unitId);
    try {
      await setLinkRoster({
        unitId: member.unitId,
        protocol: link.protocol,
        durableKey: link.durableKey,
        onRoster: false,
      });
    } catch (err: unknown) {
      console.warn('[TeamRoster] remove device failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
    } finally {
      setBusyUnitId(null);
    }
  };

  const removeMemberFromRoster = async (member: TeamMember) => {
    setBusyUnitId(member.unitId);
    try {
      await upsertMember({
        unitId: member.unitId,
        callsign: member.callsign,
        isSelf: member.isSelf,
        onRoster: false,
      });
      setSelectedUnitIds((prev) => {
        const next = new Set(prev);
        next.delete(member.unitId);
        return next;
      });
    } catch (err: unknown) {
      console.warn('[TeamRoster] remove failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
    } finally {
      setBusyUnitId(null);
    }
  };

  const beginAddMember = (member: TeamMember) => {
    if (member.links.length === 0) {
      addToast(t('teamRoster.devicePickerNeedLinks'), 'error');
      return;
    }
    setCardPickerOpen(false);
    setDevicePicker({ mode: 'add', member });
  };

  const toggleSelected = (unitId: number) => {
    setSelectedUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(unitId)) next.delete(unitId);
      else next.add(unitId);
      return next;
    });
  };

  const selectedRecipientCount = useMemo(
    () => rosterMembers.reduce((n, m) => n + (selectedUnitIds.has(m.unitId) ? 1 : 0), 0),
    [rosterMembers, selectedUnitIds],
  );

  const selectAllRoster = () => {
    setSelectedUnitIds(new Set(rosterMembers.map((m) => m.unitId)));
  };

  const clearSelection = () => {
    setSelectedUnitIds(new Set());
  };

  const insertAtMention = (member: TeamMember) => {
    setSelectedUnitIds((prev) => new Set(prev).add(member.unitId));
    setTeamDraft((d) => {
      const mention = `@${member.callsign}`;
      if (d.includes(mention)) return d;
      const sep = d.trim().length === 0 ? '' : d.endsWith(' ') ? '' : ' ';
      return `${d}${sep}${mention} `;
    });
  };

  const handleTeamSend = () => {
    if (!onSendDm) return;
    const text = teamDraft.trim();
    if (!text) return;
    const recipients = rosterMembers.filter((m) => selectedUnitIds.has(m.unitId));
    if (recipients.length === 0) {
      addToast(t('teamRoster.teamSendNoRecipients'), 'error');
      return;
    }
    setFanOutBusy(true);
    try {
      const { sent, skipped } = fanOutTeamMessage({
        recipients,
        presenceByUnit,
        text,
        sendDm: onSendDm,
      });
      addToast(t('teamRoster.teamSendResult', { sent, skipped }), sent > 0 ? 'success' : 'error');
      if (sent > 0) setTeamDraft('');
    } finally {
      setFanOutBusy(false);
    }
  };

  return (
    <section
      aria-labelledby="team-roster-title"
      className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex max-w-prose flex-col gap-1">
          <h2 id="team-roster-title" className="text-ink-100 text-base font-semibold">
            {t('teamRoster.rosterTitle')}
          </h2>
          <p className="text-ink-300 text-label">{t('teamRoster.rosterIntro')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClassName('secondary', 'md')}
            aria-label={t('teamRoster.addExistingToRoster')}
            onClick={() => {
              setCardPickerOpen(true);
            }}
          >
            {t('teamRoster.addExistingToRoster')}
          </button>
          <button
            type="button"
            className={buttonClassName('primary', 'md')}
            aria-label={t('teamRoster.createOnRoster')}
            onClick={() => {
              setCreating(true);
            }}
          >
            {t('teamRoster.createOnRoster')}
          </button>
        </div>
      </div>

      {rosterMembers.length === 0 ? (
        <p className="text-ink-400 text-label">{t('teamRoster.emptyRoster')}</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-left">
              <thead>
                <tr className="border-ink-700 text-ink-300 text-label border-b">
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    <span className="sr-only">{t('teamRoster.selectRecipients')}</span>
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('teamRoster.presence')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('teamRoster.unitId')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('teamRoster.callsign')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('teamRoster.role')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('teamRoster.eventDevices')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    {t('teamRoster.lastActive')}
                  </th>
                  <th scope="col" className="px-2 py-1.5 font-medium">
                    <span className="sr-only">{t('teamRoster.rosterActions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rosterMembers.map((member) => {
                  const presence = presenceByUnit.get(member.unitId);
                  const eventDevices = rosterLinksOf(member);
                  return (
                    <tr
                      key={member.unitId}
                      className={`border-ink-800 border-b ${member.isSelf ? 'bg-brand-green/10' : ''}`}
                    >
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          checked={selectedUnitIds.has(member.unitId)}
                          onChange={() => {
                            toggleSelected(member.unitId);
                          }}
                          aria-label={t('teamRoster.selectRecipientAria', {
                            callsign: member.callsign,
                          })}
                        />
                      </td>
                      <td className="px-2 py-2 align-top">
                        {presence ? <TeamPresenceDot status={presence.aggregateStatus} /> : null}
                      </td>
                      <td className="text-ink-100 px-2 py-2 align-top font-mono text-sm">
                        {member.unitId}
                        {member.isSelf ? (
                          <span className="rounded-badge bg-brand-green text-app-bg text-2xs ml-2 inline-flex px-1.5 py-0.5">
                            {t('teamRoster.selfBadge')}
                          </span>
                        ) : null}
                      </td>
                      <td className="text-ink-100 px-2 py-2 align-top text-sm">
                        <button
                          type="button"
                          className="hover:text-bright-green inline-flex items-center gap-2"
                          aria-label={t('teamRoster.openContactCard', {
                            callsign: member.callsign,
                          })}
                          onClick={() => {
                            setDetailUnitId(member.unitId);
                          }}
                        >
                          {member.callsign}
                        </button>
                      </td>
                      <td className="text-ink-300 px-2 py-2 align-top text-sm">
                        {member.role ?? '—'}
                      </td>
                      <td className="px-2 py-2 align-top">
                        <ul className="flex flex-col gap-1">
                          {eventDevices.map((link) => (
                            <li
                              key={`${link.protocol}:${link.durableKey}`}
                              className="flex flex-wrap items-center gap-1"
                            >
                              <span className="text-ink-200 text-label">
                                {t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol])}
                                {link.longName ? ` · ${link.longName}` : ''}
                              </span>
                              <button
                                type="button"
                                className={buttonClassName('secondary', 'sm')}
                                disabled={busyUnitId === member.unitId}
                                aria-label={t('teamRoster.removeDeviceFromRosterAria', {
                                  name: link.longName?.trim() || link.durableKey,
                                })}
                                onClick={() => {
                                  void removeDeviceFromRoster(member, link);
                                }}
                              >
                                {t('teamRoster.removeDevice')}
                              </button>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {member.links.some((l) => !l.onRoster) ? (
                            <button
                              type="button"
                              className={buttonClassName('secondary', 'sm')}
                              onClick={() => {
                                setDevicePicker({ mode: 'addDevices', member });
                              }}
                            >
                              {t('teamRoster.addDevice')}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className={buttonClassName('secondary', 'sm')}
                            onClick={() => {
                              setDevicePicker({ mode: 'manage', member });
                            }}
                          >
                            {t('teamRoster.manageDevices')}
                          </button>
                        </div>
                      </td>
                      <td className="text-ink-300 px-2 py-2 align-top text-sm">
                        {presence?.lastActive
                          ? t(TEAM_PROTOCOL_LABEL_KEYS[presence.lastActive.link.protocol])
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-end align-top">
                        <div className="flex flex-wrap justify-end gap-1">
                          <button
                            type="button"
                            className={buttonClassName('secondary', 'sm')}
                            aria-label={t('teamRoster.mentionAria', {
                              callsign: member.callsign,
                            })}
                            onClick={() => {
                              insertAtMention(member);
                            }}
                          >
                            @{member.callsign}
                          </button>
                          <button
                            type="button"
                            className={buttonClassName('secondary', 'sm')}
                            disabled={busyUnitId === member.unitId}
                            aria-label={t('teamRoster.removeFromRosterAria')}
                            onClick={() => {
                              void removeMemberFromRoster(member);
                            }}
                          >
                            {t('teamRoster.removeFromRoster')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {onSendDm ? (
            <section
              aria-labelledby="team-roster-compose"
              className="border-ink-700 flex flex-col gap-2 rounded border p-3"
            >
              <h3 id="team-roster-compose" className="text-ink-100 text-sm font-semibold">
                {t('teamRoster.teamMessageTitle')}
              </h3>
              <p className="text-ink-400 text-label">{t('teamRoster.teamMessageIntro')}</p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClassName('secondary', 'sm')}
                  onClick={selectAllRoster}
                >
                  {t('teamRoster.selectAll')}
                </button>
                <button
                  type="button"
                  className={buttonClassName('secondary', 'sm')}
                  onClick={clearSelection}
                >
                  {t('teamRoster.clearSelection')}
                </button>
              </div>
              <textarea
                className={`${INPUT_CLASS} min-h-[5rem]`}
                value={teamDraft}
                onChange={(e) => {
                  setTeamDraft(e.target.value);
                }}
                aria-label={t('teamRoster.teamComposeAria')}
                placeholder={t('teamRoster.teamComposePlaceholder')}
              />
              <div className="flex justify-end">
                <button
                  type="button"
                  className={buttonClassName('primary', 'md')}
                  disabled={fanOutBusy || !teamDraft.trim() || selectedRecipientCount === 0}
                  onClick={handleTeamSend}
                >
                  {t('teamRoster.teamSend', { count: selectedRecipientCount })}
                </button>
              </div>
            </section>
          ) : null}
        </>
      )}

      {cardPickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={cardPickerTitleId}
            className="border-ink-600 bg-ink-900 rounded-modal shadow-level-3 flex max-h-[90vh] w-full max-w-md flex-col border p-4"
          >
            <h2 id={cardPickerTitleId} className="text-ink-100 mb-1 text-base font-semibold">
              {t('teamRoster.addExistingToRoster')}
            </h2>
            <p className="text-ink-400 text-label mb-3">{t('teamRoster.addExistingDeviceHint')}</p>
            {offRosterMembers.length === 0 ? (
              <p className="text-ink-400 text-label">{t('teamRoster.noCardsOffRoster')}</p>
            ) : (
              <ul
                className="border-ink-700 max-h-64 overflow-y-auto rounded border"
                aria-label={t('teamRoster.selectContactAria')}
              >
                {offRosterMembers.map((member) => (
                  <li key={member.unitId}>
                    <button
                      type="button"
                      className="hover:bg-ink-800 text-ink-200 w-full px-3 py-2 text-left text-sm"
                      disabled={busyUnitId === member.unitId}
                      aria-label={t('teamRoster.pickCardForRosterAria', {
                        callsign: member.callsign,
                      })}
                      onClick={() => {
                        beginAddMember(member);
                      }}
                    >
                      #{member.unitId} {member.callsign}
                      {member.role ? ` · ${member.role}` : ''}
                      <span className="text-ink-400 text-label mt-0.5 block">
                        {t('teamRoster.deviceCount', { count: member.links.length })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className={buttonClassName('secondary', 'md')}
                onClick={() => {
                  setCardPickerOpen(false);
                }}
              >
                {t('teamRoster.cancel')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {devicePicker ? (
        <TeamRosterDevicePickerDialog
          member={devicePicker.member}
          preselectRostered={devicePicker.mode === 'manage'}
          onlyOffRoster={devicePicker.mode === 'addDevices'}
          title={
            devicePicker.mode === 'addDevices'
              ? t('teamRoster.addDeviceTitle')
              : devicePicker.mode === 'manage'
                ? t('teamRoster.manageDevicesTitle')
                : t('teamRoster.selectDevicesTitle')
          }
          confirmLabel={
            devicePicker.mode === 'manage'
              ? t('teamRoster.saveDeviceSelection')
              : t('teamRoster.confirmDevices')
          }
          onClose={() => {
            setDevicePicker(null);
          }}
          onConfirm={async (selected) => {
            await applyRosterDevices(devicePicker.member, selected, devicePicker.mode);
          }}
        />
      ) : null}

      {creating ? (
        <TeamContactEditorDialog
          member={null}
          onClose={(createdUnitId) => {
            setCreating(false);
            if (typeof createdUnitId !== 'number') return;
            const created = useTeamRosterStore
              .getState()
              .members.find((m) => m.unitId === createdUnitId);
            if (!created || created.links.length === 0) {
              addToast(t('teamRoster.devicePickerNeedLinks'), 'error');
              return;
            }
            setDevicePicker({ mode: 'add', member: created });
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
