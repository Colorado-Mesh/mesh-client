import { useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buttonClassName } from '@/renderer/components/ui/Button';
import type { TeamMember, TeamMemberLink } from '@/shared/teamRosterTypes';

import { TEAM_PROTOCOL_LABEL_KEYS } from './TeamProtocolBadges';

function linkKey(link: TeamMemberLink): string {
  return `${link.protocol}:${link.durableKey}`;
}

export interface TeamRosterDevicePickerDialogProps {
  member: TeamMember;
  /** When true, start with currently rostered devices checked (manage/add mode). */
  preselectRostered?: boolean;
  /** Limit the chooser to links not yet on the roster. */
  onlyOffRoster?: boolean;
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: (selected: TeamMemberLink[]) => void | Promise<void>;
}

/** Multi-select devices from a Contact Card for the Team Roster event set. */
export function TeamRosterDevicePickerDialog({
  member,
  preselectRostered = false,
  onlyOffRoster = false,
  title,
  confirmLabel,
  onClose,
  onConfirm,
}: TeamRosterDevicePickerDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const candidates = useMemo(() => {
    const links = onlyOffRoster ? member.links.filter((l) => !l.onRoster) : member.links;
    return links;
  }, [member.links, onlyOffRoster]);
  const [selected, setSelected] = useState<Set<string>>(() => {
    const next = new Set<string>();
    if (preselectRostered) {
      for (const link of member.links) {
        if (link.onRoster) next.add(linkKey(link));
      }
    }
    return next;
  });
  const [busy, setBusy] = useState(false);

  const toggle = (link: TeamMemberLink) => {
    const key = linkKey(link);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleConfirm = async () => {
    const picked = candidates.filter((l) => selected.has(linkKey(l)));
    if (picked.length === 0) return;
    setBusy(true);
    try {
      await onConfirm(picked);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-ink-600 bg-ink-900 rounded-modal shadow-level-3 flex max-h-[90vh] w-full max-w-md flex-col border p-4"
      >
        <h2 id={titleId} className="text-ink-100 mb-1 text-base font-semibold">
          {title}
        </h2>
        <p className="text-ink-300 text-label mb-3">
          {t('teamRoster.devicePickerIntro', { callsign: member.callsign })}
        </p>

        {candidates.length === 0 ? (
          <p className="text-ink-400 text-label">{t('teamRoster.devicePickerEmpty')}</p>
        ) : (
          <ul
            className="border-ink-700 max-h-64 overflow-y-auto rounded border"
            aria-label={t('teamRoster.devicePickerListAria')}
          >
            {candidates.map((link) => {
              const key = linkKey(link);
              const checked = selected.has(key);
              return (
                <li key={key} className="border-ink-800 border-b last:border-b-0">
                  <label className="hover:bg-ink-800 flex cursor-pointer items-start gap-2 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => {
                        toggle(link);
                      }}
                      aria-label={t('teamRoster.devicePickerItemAria', {
                        protocol: t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol]),
                        name: link.longName?.trim() || link.durableKey,
                      })}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="text-ink-100 block text-sm">
                        {t(TEAM_PROTOCOL_LABEL_KEYS[link.protocol])}
                        {link.longName ? ` · ${link.longName}` : ''}
                      </span>
                      <span className="text-ink-400 text-label font-mono break-all">
                        {link.durableKey}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className={buttonClassName('secondary', 'md')}
            disabled={busy}
            onClick={onClose}
          >
            {t('teamRoster.cancel')}
          </button>
          <button
            type="button"
            className={buttonClassName('primary', 'md')}
            disabled={busy || selected.size === 0 || candidates.length === 0}
            onClick={() => {
              void handleConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
