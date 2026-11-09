import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/renderer/components/Toast';
import { buttonClassName } from '@/renderer/components/ui/Button';
import { INPUT_CLASS } from '@/renderer/components/ui/formClasses';
import { useModalFocusTrap } from '@/renderer/hooks/useModalFocusTrap';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { useTeamRosterStore } from '@/renderer/stores/teamRosterStore';
import type { TeamMember } from '@/shared/teamRosterTypes';
import { rosterLinksOf, TEAM_UNIT_ID_MAX, TEAM_UNIT_ID_MIN } from '@/shared/teamRosterTypes';

interface TeamContactEditorDialogProps {
  /** Null = create mode. */
  member: TeamMember | null;
  /** Optional created unit id when create-mode save succeeds. */
  onClose: (createdUnitId?: number | null) => void;
}

/** Create or edit a Contact Card (callsign, Unit ID, role, self flag). */
export function TeamContactEditorDialog({ member, onClose }: TeamContactEditorDialogProps) {
  const { t } = useTranslation();
  const { addToast } = useToast();
  const upsertMember = useTeamRosterStore((s) => s.upsertMember);
  const allocateUnitId = useTeamRosterStore((s) => s.allocateUnitId);
  const members = useTeamRosterStore((s) => s.members);
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const { suppressRestoreFocus } = useModalFocusTrap(panelRef, () => {
    onClose();
  });

  const [unitId, setUnitId] = useState(String(member?.unitId ?? ''));
  const [callsign, setCallsign] = useState(member?.callsign ?? '');
  const [role, setRole] = useState(member?.role ?? '');
  const [isSelf, setIsSelf] = useState(member?.isSelf ?? false);
  const [busy, setBusy] = useState(false);
  const isCreate = member == null;
  const rosterDeviceCount = member ? rosterLinksOf(member).length : 0;

  useEffect(() => {
    if (!isCreate) return;
    let cancelled = false;
    void (async () => {
      try {
        const id = await allocateUnitId();
        if (!cancelled) setUnitId(String(id));
      } catch (err: unknown) {
        console.warn('[TeamContactEditor] allocate failed ' + errLikeToLogString(err));
        if (!cancelled) addToast(t('teamRoster.allocateFailed'), 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isCreate, allocateUnitId, addToast, t]);

  const handleSave = async () => {
    const parsedUnit = Number.parseInt(unitId, 10);
    if (
      !Number.isInteger(parsedUnit) ||
      parsedUnit < TEAM_UNIT_ID_MIN ||
      parsedUnit > TEAM_UNIT_ID_MAX
    ) {
      addToast(t('teamRoster.saveFailed'), 'error');
      return;
    }
    if (isCreate && members.some((m) => m.unitId === parsedUnit)) {
      addToast(t('teamRoster.unitIdTaken', { unitId: parsedUnit }), 'error');
      return;
    }
    const trimmed = callsign.trim();
    if (!trimmed) {
      addToast(t('teamRoster.saveFailed'), 'error');
      return;
    }
    setBusy(true);
    try {
      await upsertMember({
        unitId: parsedUnit,
        callsign: trimmed,
        role: role.trim() || null,
        isSelf,
      });
      if (isCreate) suppressRestoreFocus();
      onClose(isCreate ? parsedUnit : null);
    } catch (err: unknown) {
      console.warn('[TeamContactEditor] save failed ' + errLikeToLogString(err));
      addToast(t('teamRoster.saveFailed'), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-ink-600 bg-ink-900 rounded-modal shadow-level-3 w-full max-w-md border p-4"
      >
        <h2 id={titleId} className="text-ink-100 mb-3 text-base font-semibold">
          {isCreate ? t('teamRoster.addContact') : t('teamRoster.editContact')}
        </h2>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-ink-300 text-label">{t('teamRoster.unitId')}</span>
            <input
              type="number"
              min={TEAM_UNIT_ID_MIN}
              max={TEAM_UNIT_ID_MAX}
              value={unitId}
              disabled={!isCreate || busy}
              onChange={(e) => {
                setUnitId(e.target.value);
              }}
              aria-label={t('teamRoster.unitIdAria')}
              className={INPUT_CLASS}
            />
          </label>
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
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isSelf}
              disabled={busy}
              onChange={(e) => {
                setIsSelf(e.target.checked);
              }}
              aria-label={t('teamRoster.isSelfAria')}
            />
            <span className="text-ink-200 text-label">{t('teamRoster.isSelf')}</span>
          </label>
          {!isCreate ? (
            <p className="text-ink-400 text-label">
              {t('teamRoster.rosterDeviceStatus', { count: rosterDeviceCount })}
            </p>
          ) : (
            <p className="text-ink-400 text-label">{t('teamRoster.rosterSelectAfterCreate')}</p>
          )}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className={buttonClassName('secondary', 'md')}
            disabled={busy}
            onClick={() => {
              onClose();
            }}
          >
            {t('teamRoster.cancel')}
          </button>
          <button
            type="button"
            className={buttonClassName('primary', 'md')}
            disabled={busy}
            onClick={() => {
              void handleSave();
            }}
          >
            {t('teamRoster.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
