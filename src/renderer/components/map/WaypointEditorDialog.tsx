import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buttonClassName } from '@/renderer/components/ui/Button';
import { CHECKBOX_CLASS, INPUT_BOX_SM_CLASS } from '@/renderer/components/ui/formClasses';
import { useModalFocusTrap } from '@/renderer/hooks/useModalFocusTrap';
import type { MeshWaypoint } from '@/renderer/lib/types';

const NAME_MAX = 29;

export interface WaypointEditorDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  initial?: Partial<MeshWaypoint> & { latitude: number; longitude: number };
  myNodeNum: number;
  onClose: () => void;
  onSubmit: (wp: Omit<MeshWaypoint, 'from' | 'timestamp'>) => Promise<void> | void;
}

/** Hours remaining until `expire` (unix seconds), or 0 when unset / past / delete sentinel. */
export function expireHoursFromUnix(
  expire: number | undefined,
  nowSec = Math.floor(Date.now() / 1000),
): number {
  if (expire == null || expire <= 1) return 0;
  if (expire <= nowSec) return 0;
  return Math.max(0, Math.round((expire - nowSec) / 3600));
}

/** Create / edit Meshtastic waypoints (no geofence). Delete-for-everyone uses expire:1. */
export function WaypointEditorDialog({
  open,
  mode,
  initial,
  myNodeNum,
  onClose,
  onSubmit,
}: WaypointEditorDialogProps) {
  if (!open || !initial) return null;
  const resetKey = `${mode}:${initial.id ?? 'new'}:${initial.latitude}:${initial.longitude}:${initial.name ?? ''}:${initial.lockedTo ?? 0}:${initial.expire ?? 0}`;
  return (
    <WaypointEditorDialogForm
      key={resetKey}
      mode={mode}
      initial={initial}
      myNodeNum={myNodeNum}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );
}

interface WaypointEditorDialogFormProps {
  mode: 'create' | 'edit';
  initial: Partial<MeshWaypoint> & { latitude: number; longitude: number };
  myNodeNum: number;
  onClose: () => void;
  onSubmit: (wp: Omit<MeshWaypoint, 'from' | 'timestamp'>) => Promise<void> | void;
}

function WaypointEditorDialogForm({
  mode,
  initial,
  myNodeNum,
  onClose,
  onSubmit,
}: WaypointEditorDialogFormProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const nameId = useId();
  const descId = useId();
  const iconId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const initialExpireHours = expireHoursFromUnix(initial.expire);
  const [name, setName] = useState(() => (initial.name ?? '').slice(0, NAME_MAX));
  const [description, setDescription] = useState(() => initial.description ?? '');
  const [icon, setIcon] = useState(() => initial.icon ?? 0);
  const [locked, setLocked] = useState(() => (initial.lockedTo ?? 0) > 0);
  const [expireHours, setExpireHours] = useState(initialExpireHours);
  const [expireTouched, setExpireTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useModalFocusTrap(panelRef, onClose);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const lockedOwned =
    mode === 'edit' &&
    (initial.lockedTo == null || initial.lockedTo === 0 || initial.lockedTo === myNodeNum);
  const canEdit = mode === 'create' || lockedOwned;

  const submit = async () => {
    if (!canEdit) return;
    const trimmed = name.trim().slice(0, NAME_MAX);
    if (!trimmed) {
      setError(t('mapPanel.waypointNameRequired'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const expire = !expireTouched
        ? (initial.expire ?? 0)
        : expireHours > 0
          ? Math.floor(Date.now() / 1000) + Math.floor(expireHours * 3600)
          : 0;
      await onSubmit({
        id: initial.id ?? (Math.floor(Math.random() * 0xffffffff) >>> 0 || 1),
        latitude: initial.latitude,
        longitude: initial.longitude,
        name: trimmed,
        description: description.trim(),
        icon: Number.isFinite(icon) ? Math.trunc(icon) : 0,
        lockedTo: locked ? myNodeNum : 0,
        expire,
      });
      // A pending save from a previous editor instance must not close a newly opened one.
      if (mountedRef.current) onClose();
    } catch (err) {
      console.warn('[WaypointEditorDialog] submit failed', err);
      if (mountedRef.current) setError(t('mapPanel.waypointSaveFailed'));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t('common.cancel')}
        className="absolute inset-0 cursor-pointer border-0 bg-black/60 p-0 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="border-ink-700 bg-ink-900 rounded-modal shadow-level-3 relative max-h-[90vh] w-full max-w-md overflow-auto border p-4"
      >
        <h2 id={titleId} className="text-ink-100 mb-3 text-base font-semibold">
          {mode === 'create' ? t('mapPanel.waypointCreateTitle') : t('mapPanel.waypointEditTitle')}
        </h2>
        {!canEdit ? (
          <p className="text-muted text-sm">{t('mapPanel.waypointLockedByOther')}</p>
        ) : (
          <div className="space-y-3">
            <div>
              <label htmlFor={nameId} className="text-muted text-xs">
                {t('mapPanel.waypointNameLabel')}
              </label>
              <input
                id={nameId}
                className={`${INPUT_BOX_SM_CLASS} mt-1 w-full`}
                value={name}
                maxLength={NAME_MAX}
                aria-label={t('mapPanel.waypointNameLabel')}
                onChange={(e) => {
                  setName(e.target.value.slice(0, NAME_MAX));
                }}
              />
            </div>
            <div>
              <label htmlFor={descId} className="text-muted text-xs">
                {t('mapPanel.waypointDescriptionLabel')}
              </label>
              <textarea
                id={descId}
                className={`${INPUT_BOX_SM_CLASS} mt-1 w-full`}
                rows={3}
                value={description}
                aria-label={t('mapPanel.waypointDescriptionLabel')}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
              />
            </div>
            <div>
              <label htmlFor={iconId} className="text-muted text-xs">
                {t('mapPanel.waypointIconLabel')}
              </label>
              <input
                id={iconId}
                type="number"
                className={`${INPUT_BOX_SM_CLASS} mt-1 w-full`}
                value={icon}
                aria-label={t('mapPanel.waypointIconLabel')}
                onChange={(e) => {
                  setIcon(Number(e.target.value) || 0);
                }}
              />
            </div>
            <label className="text-muted flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={locked}
                onChange={(e) => {
                  setLocked(e.target.checked);
                }}
              />
              {t('mapPanel.waypointLockLabel')}
            </label>
            <div>
              <label className="text-muted text-xs" htmlFor={`${nameId}-expire`}>
                {t('mapPanel.waypointExpireLabel')}
              </label>
              <input
                id={`${nameId}-expire`}
                type="number"
                min={0}
                className={`${INPUT_BOX_SM_CLASS} mt-1 w-full`}
                value={expireHours}
                aria-label={t('mapPanel.waypointExpireLabel')}
                onChange={(e) => {
                  setExpireTouched(true);
                  setExpireHours(Math.max(0, Number(e.target.value) || 0));
                }}
              />
            </div>
            {error ? (
              <p role="alert" className="text-xs text-red-400">
                {error}
              </p>
            ) : null}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={buttonClassName('secondary', 'sm')} onClick={onClose}>
            {t('common.cancel')}
          </button>
          {canEdit ? (
            <button
              type="button"
              className={buttonClassName('primary', 'sm')}
              disabled={busy}
              aria-label={t('mapPanel.waypointSave')}
              onClick={() => {
                void submit();
              }}
            >
              {t('mapPanel.waypointSave')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
