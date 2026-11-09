import { useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { buttonClassName } from '@/renderer/components/ui/Button';
import { INPUT_CLASS } from '@/renderer/components/ui/formClasses';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import type { TeamLinkCandidate } from '@/renderer/lib/teamRoster/durableKey';
import { useTeamRosterStore } from '@/renderer/stores/teamRosterStore';
import type { TeamMember } from '@/shared/teamRosterTypes';

type SuggestMode = 'existing' | 'create';

export interface SuggestToTeamContactModalProps {
  candidate: TeamLinkCandidate;
  onClose: () => void;
  /** When true (local radio node), new cards default isSelf if none exists yet. */
  preferSelf?: boolean;
}

function findOwnerOfDurableKey(
  members: TeamMember[],
  protocol: TeamLinkCandidate['protocol'],
  durableKey: string,
): TeamMember | undefined {
  return members.find((m) =>
    m.links.some((l) => l.protocol === protocol && l.durableKey === durableKey),
  );
}

/** Modal: link a node/peer to an existing contact card or create a new one. */
export function SuggestToTeamContactModal({
  candidate,
  onClose,
  preferSelf = false,
}: SuggestToTeamContactModalProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const titleId = useId();
  const members = useTeamRosterStore((s) => s.members);
  const upsertMember = useTeamRosterStore((s) => s.upsertMember);
  const setLink = useTeamRosterStore((s) => s.setLink);
  const allocateUnitId = useTeamRosterStore((s) => s.allocateUnitId);

  const existingOwner = useMemo(
    () => findOwnerOfDurableKey(members, candidate.protocol, candidate.durableKey),
    [members, candidate.protocol, candidate.durableKey],
  );

  const [mode, setMode] = useState<SuggestMode>(members.length > 0 ? 'existing' : 'create');
  const [query, setQuery] = useState('');
  const [selectedUnitId, setSelectedUnitId] = useState<number | null>(null);
  const [callsign, setCallsign] = useState(candidate.longName?.trim() || '');
  const [role, setRole] = useState('OP');
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.callsign.toLowerCase().includes(q) ||
        String(m.unitId).includes(q) ||
        (m.role ?? '').toLowerCase().includes(q),
    );
  }, [members, query]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const linkToUnit = async (unitId: number) => {
    setBusy(true);
    try {
      await setLink({
        unitId,
        protocol: candidate.protocol,
        durableKey: candidate.durableKey,
        nodeId: candidate.nodeId ?? null,
        longName: candidate.longName ?? null,
        identityId: candidate.identityId ?? null,
      });
      onClose();
    } catch (err: unknown) {
      console.warn('[SuggestToTeamContact] link failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.linkFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleCreateAndLink = async () => {
    const trimmed = callsign.trim();
    if (!trimmed) {
      addToast(t('teamRoster.saveFailed'), 'error');
      return;
    }
    setBusy(true);
    try {
      const unitId = await allocateUnitId();
      const hasSelf = members.some((m) => m.isSelf);
      await upsertMember({
        unitId,
        callsign: trimmed,
        role: role.trim() || null,
        isSelf: preferSelf && !hasSelf,
        onRoster: false,
      });
      await setLink({
        unitId,
        protocol: candidate.protocol,
        durableKey: candidate.durableKey,
        nodeId: candidate.nodeId ?? null,
        longName: candidate.longName ?? null,
        identityId: candidate.identityId ?? null,
      });
      onClose();
    } catch (err: unknown) {
      console.warn('[SuggestToTeamContact] create failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.linkFailed'), 'error');
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
        <h2 id={titleId} className="text-ink-100 mb-3 text-base font-semibold">
          {t('teamRoster.suggestTitle')}
        </h2>

        {existingOwner ? (
          <p className="text-ink-300 text-label mb-3" role="status">
            {t('teamRoster.suggestAlreadyLinked', {
              callsign: existingOwner.callsign,
              unitId: existingOwner.unitId,
            })}
          </p>
        ) : (
          <>
            <div
              className="mb-3 flex gap-2"
              role="tablist"
              aria-label={t('teamRoster.suggestTitle')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'existing'}
                className={buttonClassName(mode === 'existing' ? 'primary' : 'secondary', 'sm')}
                disabled={members.length === 0 || busy}
                onClick={() => {
                  setMode('existing');
                }}
              >
                {t('teamRoster.suggestAddExisting')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'create'}
                className={buttonClassName(mode === 'create' ? 'primary' : 'secondary', 'sm')}
                disabled={busy}
                onClick={() => {
                  setMode('create');
                }}
              >
                {t('teamRoster.suggestCreateNew')}
              </button>
            </div>

            {mode === 'existing' ? (
              <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
                <input
                  type="search"
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                  placeholder={t('teamRoster.suggestSearch')}
                  aria-label={t('teamRoster.suggestSearch')}
                  className={INPUT_CLASS}
                  disabled={busy}
                />
                {filtered.length === 0 ? (
                  <p className="text-ink-400 text-label">{t('teamRoster.suggestNoContacts')}</p>
                ) : (
                  <ul
                    className="border-ink-700 max-h-48 overflow-y-auto rounded border"
                    aria-label={t('teamRoster.selectContactAria')}
                  >
                    {filtered.map((m) => (
                      <li key={m.unitId}>
                        <button
                          type="button"
                          className={`hover:bg-ink-800 w-full px-3 py-2 text-left text-sm ${
                            selectedUnitId === m.unitId ? 'bg-ink-800 text-ink-100' : 'text-ink-200'
                          }`}
                          aria-pressed={selectedUnitId === m.unitId}
                          disabled={busy}
                          onClick={() => {
                            setSelectedUnitId(m.unitId);
                          }}
                        >
                          #{m.unitId} {m.callsign}
                          {m.role ? ` · ${m.role}` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-ink-300 text-label">{t('teamRoster.callsign')}</span>
                  <input
                    type="text"
                    value={callsign}
                    disabled={busy}
                    onChange={(e) => {
                      setCallsign(e.target.value);
                    }}
                    aria-label={t('teamRoster.callsignAria')}
                    className={INPUT_CLASS}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-ink-300 text-label">{t('teamRoster.role')}</span>
                  <input
                    type="text"
                    value={role}
                    disabled={busy}
                    onChange={(e) => {
                      setRole(e.target.value);
                    }}
                    aria-label={t('teamRoster.roleAria')}
                    className={INPUT_CLASS}
                  />
                </label>
              </div>
            )}
          </>
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
          {!existingOwner && mode === 'existing' ? (
            <button
              type="button"
              className={buttonClassName('primary', 'md')}
              disabled={busy || selectedUnitId == null}
              onClick={() => {
                if (selectedUnitId != null) void linkToUnit(selectedUnitId);
              }}
            >
              {t('teamRoster.suggestSubmit')}
            </button>
          ) : null}
          {!existingOwner && mode === 'create' ? (
            <button
              type="button"
              className={buttonClassName('primary', 'md')}
              disabled={busy}
              onClick={() => {
                void handleCreateAndLink();
              }}
            >
              {t('teamRoster.suggestCreateSubmit')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
