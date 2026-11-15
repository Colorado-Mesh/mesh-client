import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { buttonClassName } from '@/renderer/components/ui/Button';
import { CHECKBOX_CLASS, INPUT_BOX_SM_CLASS } from '@/renderer/components/ui/formClasses';
import { useModalFocusTrap } from '@/renderer/hooks/useModalFocusTrap';
import type { MeshWaypoint } from '@/renderer/lib/types';

const NAME_MAX = 29;
const LNG_MIN = -180;
const LNG_MAX = 180;
const LAT_MIN = -90;
const LAT_MAX = 90;

function clampLng(value: number): number {
  return Math.min(LNG_MAX, Math.max(LNG_MIN, value));
}

function clampLat(value: number): number {
  return Math.min(LAT_MAX, Math.max(LAT_MIN, value));
}

/** True when west/east and south/north are finite, in-range, and ordered. */
export function isValidWaypointBoundingBox(box: {
  west: number;
  south: number;
  east: number;
  north: number;
}): boolean {
  const { west, south, east, north } = box;
  if (![west, south, east, north].every(Number.isFinite)) return false;
  if (west < LNG_MIN || west > LNG_MAX || east < LNG_MIN || east > LNG_MAX) return false;
  if (south < LAT_MIN || south > LAT_MAX || north < LAT_MIN || north > LAT_MAX) return false;
  return west < east && south < north;
}

/** Default ±delta box around a point, clamped to geographic ranges (poles / antimeridian). */
export function defaultBoundingBoxAround(
  longitude: number,
  latitude: number,
  delta = 0.01,
): { west: number; south: number; east: number; north: number } {
  return {
    west: clampLng(longitude - delta),
    south: clampLat(latitude - delta),
    east: clampLng(longitude + delta),
    north: clampLat(latitude + delta),
  };
}

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

/** Create / edit Meshtastic waypoints (including optional 2.8 geofence fields). */
export function WaypointEditorDialog({
  open,
  mode,
  initial,
  myNodeNum,
  onClose,
  onSubmit,
}: WaypointEditorDialogProps) {
  if (!open || !initial) return null;
  const box = initial.boundingBox;
  const boxKey = box ? `${box.west}:${box.south}:${box.east}:${box.north}` : 'none';
  const resetKey = `${mode}:${initial.id ?? 'new'}:${initial.latitude}:${initial.longitude}:${initial.name ?? ''}:${initial.lockedTo ?? 0}:${initial.expire ?? 0}:${initial.geofenceRadius ?? 0}:${boxKey}:${initial.notifyOnEnter === true ? 1 : 0}:${initial.notifyOnExit === true ? 1 : 0}:${initial.notifyFavoritesOnly === true ? 1 : 0}`;
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
  const [geofenceRadius, setGeofenceRadius] = useState(() =>
    typeof initial.geofenceRadius === 'number' && initial.geofenceRadius > 0
      ? initial.geofenceRadius
      : 0,
  );
  const [useBoundingBox, setUseBoundingBox] = useState(() => initial.boundingBox != null);
  const [boxWest, setBoxWest] = useState(() => {
    if (initial.boundingBox) return clampLng(initial.boundingBox.west);
    return defaultBoundingBoxAround(initial.longitude, initial.latitude).west;
  });
  const [boxSouth, setBoxSouth] = useState(() => {
    if (initial.boundingBox) return clampLat(initial.boundingBox.south);
    return defaultBoundingBoxAround(initial.longitude, initial.latitude).south;
  });
  const [boxEast, setBoxEast] = useState(() => {
    if (initial.boundingBox) return clampLng(initial.boundingBox.east);
    return defaultBoundingBoxAround(initial.longitude, initial.latitude).east;
  });
  const [boxNorth, setBoxNorth] = useState(() => {
    if (initial.boundingBox) return clampLat(initial.boundingBox.north);
    return defaultBoundingBoxAround(initial.longitude, initial.latitude).north;
  });
  const [notifyOnEnter, setNotifyOnEnter] = useState(() => initial.notifyOnEnter === true);
  const [notifyOnExit, setNotifyOnExit] = useState(() => initial.notifyOnExit === true);
  const [notifyFavoritesOnly, setNotifyFavoritesOnly] = useState(
    () => initial.notifyFavoritesOnly === true,
  );
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
    if (
      useBoundingBox &&
      !isValidWaypointBoundingBox({
        west: boxWest,
        south: boxSouth,
        east: boxEast,
        north: boxNorth,
      })
    ) {
      setError(t('mapPanel.waypointBoundingBoxInvalid'));
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
        geofenceRadius: geofenceRadius > 0 ? Math.trunc(geofenceRadius) : 0,
        boundingBox: useBoundingBox
          ? { west: boxWest, south: boxSouth, east: boxEast, north: boxNorth }
          : undefined,
        notifyOnEnter,
        notifyOnExit,
        notifyFavoritesOnly,
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
            <div>
              <label className="text-muted text-xs" htmlFor={`${nameId}-geofence-radius`}>
                {t('mapPanel.waypointGeofenceRadiusLabel')}
              </label>
              <input
                id={`${nameId}-geofence-radius`}
                type="number"
                min={0}
                className={`${INPUT_BOX_SM_CLASS} mt-1 w-full`}
                value={geofenceRadius}
                aria-label={t('mapPanel.waypointGeofenceRadiusLabel')}
                onChange={(e) => {
                  setGeofenceRadius(Math.max(0, Number(e.target.value) || 0));
                }}
              />
              <p className="text-muted text-2xs mt-1">{t('mapPanel.waypointGeofenceRadiusHint')}</p>
            </div>
            <label className="text-muted flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={useBoundingBox}
                onChange={(e) => {
                  setUseBoundingBox(e.target.checked);
                }}
              />
              {t('mapPanel.waypointBoundingBoxEnable')}
            </label>
            {useBoundingBox ? (
              <div className="border-ink-700 rounded-control grid grid-cols-2 gap-2 border p-2">
                {(
                  [
                    ['west', boxWest, setBoxWest, t('mapPanel.waypointBoundingBoxWest')],
                    ['south', boxSouth, setBoxSouth, t('mapPanel.waypointBoundingBoxSouth')],
                    ['east', boxEast, setBoxEast, t('mapPanel.waypointBoundingBoxEast')],
                    ['north', boxNorth, setBoxNorth, t('mapPanel.waypointBoundingBoxNorth')],
                  ] as const
                ).map(([key, value, setter, label]) => (
                  <div key={key}>
                    <label className="text-muted text-2xs" htmlFor={`${nameId}-box-${key}`}>
                      {label}
                    </label>
                    <input
                      id={`${nameId}-box-${key}`}
                      type="number"
                      step="0.0001"
                      className={`${INPUT_BOX_SM_CLASS} mt-0.5 w-full`}
                      value={value}
                      aria-label={label}
                      onChange={(e) => {
                        setter(Number(e.target.value));
                      }}
                    />
                  </div>
                ))}
              </div>
            ) : null}
            <label className="text-muted flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={notifyOnEnter}
                onChange={(e) => {
                  setNotifyOnEnter(e.target.checked);
                }}
              />
              {t('mapPanel.waypointNotifyOnEnter')}
            </label>
            <label className="text-muted flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={notifyOnExit}
                onChange={(e) => {
                  setNotifyOnExit(e.target.checked);
                }}
              />
              {t('mapPanel.waypointNotifyOnExit')}
            </label>
            <label className="text-muted flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={notifyFavoritesOnly}
                onChange={(e) => {
                  setNotifyFavoritesOnly(e.target.checked);
                }}
              />
              {t('mapPanel.waypointNotifyFavoritesOnly')}
            </label>
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
