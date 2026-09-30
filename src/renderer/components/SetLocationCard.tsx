import { MapPin, X } from 'lucide-react-motion';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { parseLatLonPair } from '../lib/coordinateInput';
import { formatCoordPair } from '../lib/coordUtils';
import type { OurPosition } from '../lib/gpsSource';
import type { LocationTrust } from '../lib/locationTrust';
import {
  activateSavedLocation,
  type SavedLocation,
  saveNewLocation,
  useSavedLocations,
} from '../lib/savedLocations';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useLocationPromptStore } from '../stores/locationPromptStore';
import { buttonClassName, IconButton } from './ui/Button';
import { INPUT_CLASS } from './ui/formClasses';

export function savedLocationDisplayName(
  location: Pick<SavedLocation, 'name'>,
  t: (key: string) => string,
): string {
  return location.name.trim() || t('locationPrompt.defaultName');
}

interface LocationFormProps {
  /** Prefill for the coordinates field (for example an approximate IP fix). */
  approximatePosition?: OurPosition | null;
  onSaved: (location: SavedLocation) => void;
  onCancel?: () => void;
}

/** Name + coordinates + "doesn't move" form; saving activates the new location. */
export function SavedLocationForm({ approximatePosition, onSaved, onCancel }: LocationFormProps) {
  const { t } = useTranslation();
  const idBase = useId();
  const [name, setName] = useState('');
  const [coords, setCoords] = useState('');
  const [fixed, setFixed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const parsed = parseLatLonPair(coords);
    if (!parsed) {
      setError(t('locationPrompt.invalidCoords'));
      return;
    }
    setError(null);
    onSaved(saveNewLocation({ name, lat: parsed.lat, lon: parsed.lon, fixed }));
  };

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="space-y-1">
          <label htmlFor={`${idBase}-name`} className="text-ink-300 text-label block">
            {t('locationPrompt.nameLabel')}
          </label>
          <input
            id={`${idBase}-name`}
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            placeholder={t('locationPrompt.namePlaceholder')}
            aria-label={t('locationPrompt.nameLabel')}
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`${idBase}-coords`} className="text-ink-300 text-label block">
            {t('locationPrompt.coordsLabel')}
          </label>
          <input
            id={`${idBase}-coords`}
            type="text"
            inputMode="decimal"
            value={coords}
            onChange={(e) => {
              setCoords(e.target.value);
              if (error) setError(null);
            }}
            placeholder={t('locationPrompt.coordsPlaceholder')}
            aria-label={t('locationPrompt.coordsLabel')}
            aria-invalid={error != null}
            aria-describedby={`${idBase}-coords-hint`}
            className={INPUT_CLASS}
          />
        </div>
      </div>
      <p
        id={`${idBase}-coords-hint`}
        className={error ? 'text-label text-red-400' : 'text-muted text-label'}
      >
        {error ?? t('locationPrompt.coordsHintFormats')}
      </p>
      <div className="flex items-center gap-2">
        <input
          id={`${idBase}-fixed`}
          type="checkbox"
          checked={fixed}
          onChange={(e) => {
            setFixed(e.target.checked);
          }}
          aria-label={t('locationPrompt.fixedLabel')}
          className="accent-brand-green"
        />
        <label htmlFor={`${idBase}-fixed`} className="text-ink-300 text-body cursor-pointer">
          {t('locationPrompt.fixedLabel')}
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="submit"
          aria-label={t('locationPrompt.save')}
          className={buttonClassName('primary', 'sm')}
        >
          {t('locationPrompt.save')}
        </button>
        {approximatePosition && (
          <button
            type="button"
            onClick={() => {
              setCoords(
                `${approximatePosition.lat.toFixed(5)}, ${approximatePosition.lon.toFixed(5)}`,
              );
              setError(null);
            }}
            aria-label={t('locationPrompt.useApproximate')}
            className={buttonClassName('secondary', 'sm')}
          >
            {t('locationPrompt.useApproximate')}
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={t('common.cancel')}
            className={buttonClassName('ghost', 'sm')}
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
    </form>
  );
}

interface SetLocationCardProps {
  ourPosition: OurPosition | null | undefined;
  trust: LocationTrust;
  /** Where the card renders: the startup strip can be dismissed; Diagnostics explains paused checks. */
  variant: 'startup' | 'diagnostics';
  /** Re-resolve our position in the active runtime after the saved location changes. */
  onLocationChanged?: () => void;
  onDismiss?: () => void;
}

/**
 * Prompt for where this computer is when the radio reports no GPS. Movable setups (home vs.
 * EOC) confirm or switch saved locations in one click; new places are entered once and saved.
 */
export default function SetLocationCard({
  ourPosition,
  trust,
  variant,
  onLocationChanged,
  onDismiss,
}: SetLocationCardProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const saved = useSavedLocations();
  const confirmLocation = useLocationPromptStore((s) => s.confirmLocation);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const [showForm, setShowForm] = useState(false);

  if (trust === 'trusted') return null;

  const active = saved.locations.find((l) => l.id === saved.activeId) ?? null;
  const others = saved.locations.filter((l) => l.id !== saved.activeId);
  const confirming = trust === 'needsConfirm' && active != null && !showForm;

  const selectLocation = (location: SavedLocation) => {
    if (location.id !== saved.activeId) activateSavedLocation(location.id);
    confirmLocation(location.id);
    setShowForm(false);
    onLocationChanged?.();
  };

  let title: string;
  let body: string;
  if (confirming) {
    title = t('locationPrompt.titleConfirm', { name: savedLocationDisplayName(active, t) });
    body = t('locationPrompt.bodyConfirm', {
      coords: formatCoordPair(active.lat, active.lon, coordinateFormat),
    });
  } else if (trust === 'approximate') {
    title = t('locationPrompt.titleApproximate');
    body = t('locationPrompt.bodyApproximate');
  } else {
    title = t('locationPrompt.titleUnknown');
    body = t('locationPrompt.bodyUnknown');
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-orange-500/40 bg-orange-500/10 px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <MapPin aria-hidden size={16} className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <h3 id={headingId} className="text-body font-medium text-orange-200">
            {title}
          </h3>
          <p className="text-body text-orange-200">{body}</p>
          {variant === 'diagnostics' && (
            <p className="text-label text-orange-300">{t('locationPrompt.diagnosticsPaused')}</p>
          )}

          {confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  selectLocation(active);
                }}
                aria-label={t('locationPrompt.confirmYesAria', {
                  name: savedLocationDisplayName(active, t),
                })}
                className={buttonClassName('primary', 'sm')}
              >
                {t('locationPrompt.confirmYes')}
              </button>
              {others.map((location) => (
                <button
                  key={location.id}
                  type="button"
                  onClick={() => {
                    selectLocation(location);
                  }}
                  aria-label={t('locationPrompt.switchTo', {
                    name: savedLocationDisplayName(location, t),
                  })}
                  className={buttonClassName('secondary', 'sm')}
                >
                  {savedLocationDisplayName(location, t)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setShowForm(true);
                }}
                aria-label={t('locationPrompt.newLocation')}
                className={buttonClassName('ghost', 'sm')}
              >
                {t('locationPrompt.newLocation')}
              </button>
            </div>
          ) : (
            <>
              {saved.locations.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-label text-orange-300">
                    {t('locationPrompt.savedLocationsLabel')}
                  </span>
                  {saved.locations.map((location) => (
                    <button
                      key={location.id}
                      type="button"
                      onClick={() => {
                        selectLocation(location);
                      }}
                      aria-label={t('locationPrompt.switchTo', {
                        name: savedLocationDisplayName(location, t),
                      })}
                      className={buttonClassName('secondary', 'sm')}
                    >
                      {savedLocationDisplayName(location, t)}
                    </button>
                  ))}
                </div>
              )}
              <SavedLocationForm
                approximatePosition={trust === 'approximate' ? ourPosition : null}
                onSaved={selectLocation}
                onCancel={
                  trust === 'needsConfirm' && active
                    ? () => {
                        setShowForm(false);
                      }
                    : undefined
                }
              />
            </>
          )}
        </div>
        {variant === 'startup' && onDismiss && (
          <IconButton
            icon={<X aria-hidden size={16} />}
            onClick={onDismiss}
            aria-label={t('locationPrompt.dismiss')}
            size="sm"
          />
        )}
      </div>
    </section>
  );
}
