/**
 * Mobile override of `src/renderer/components/SetLocationCard.tsx`.
 *
 * When the radio reports no GPS (unknown or approximate position), phones offer their own location
 * first: "Use this phone's location" saves and activates a "This phone" location from the native
 * GNSS fix (one "This phone" entry, updated in place on later uses, since phones move). Saved
 * locations stay one tap away, and "Enter manually" opens the unchanged desktop
 * `SavedLocationForm` (Cancel returns here). The "Still at ...?" confirmation keeps the desktop
 * card's strings and buttons and adds "Use this phone's location"; its "New location" opens these
 * phone choices instead of going straight to the manual form.
 */
import { MapPin, X } from 'lucide-react-motion';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import DesktopSetLocationCard, {
  savedLocationDisplayName,
  SavedLocationForm,
  type SetLocationCardProps,
} from '@/renderer/components/SetLocationCard';
import { buttonClassName, IconButton } from '@/renderer/components/ui/Button';
import { formatCoordPair } from '@/renderer/lib/coordUtils';
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  activateSavedLocation,
  type SavedLocation,
  saveNewLocation,
  updateSavedLocation,
  useSavedLocations,
} from '@/renderer/lib/savedLocations';
import { useCoordFormatStore } from '@/renderer/stores/coordFormatStore';
import { useLocationPromptStore } from '@/renderer/stores/locationPromptStore';

export * from '@/renderer/components/SetLocationCard';

/**
 * The startup strip above every panel is marked so `mobileShell.css` can fold it away while the
 * keyboard is up: on a phone it would otherwise take about a third of what the keyboard leaves,
 * and the conversation being typed into shrank to two lines. It returns when the keyboard closes.
 */
export default function SetLocationCard(props: SetLocationCardProps) {
  if (props.variant !== 'startup') return <LocationCard {...props} />;
  return (
    <div data-mobile-location-prompt="">
      <LocationCard {...props} />
    </div>
  );
}

/** The saved location "Use this phone's location" keeps up to date (one entry, not one per use). */
const PHONE_LOCATION_KEY = 'mesh-mobile:phoneLocationId';

function readPhoneLocationId(): string | null {
  try {
    return localStorage.getItem(PHONE_LOCATION_KEY);
  } catch (e) {
    console.debug('[mobile/SetLocationCard] phone location id unreadable', e);
    return null;
  }
}

function rememberPhoneLocationId(id: string): void {
  try {
    localStorage.setItem(PHONE_LOCATION_KEY, id);
  } catch (e) {
    console.debug('[mobile/SetLocationCard] phone location id not saved', e);
  }
}

function LocationCard(props: SetLocationCardProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const saved = useSavedLocations();
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const [manual, setManual] = useState(false);
  /** "New location" pressed on the "Still at ...?" card: show the phone / manual / saved choices. */
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmLocation = useLocationPromptStore((s) => s.confirmLocation);
  const { ourPosition, trust, variant, onDismiss, onLocationChanged } = props;

  if (trust === 'trusted') return <DesktopSetLocationCard {...props} />;

  const active = saved.locations.find((l) => l.id === saved.activeId) ?? null;
  const others = saved.locations.filter((l) => l.id !== saved.activeId);
  const confirming = trust === 'needsConfirm' && active != null && !choosing && !manual;

  const selectLocation = (location: SavedLocation) => {
    if (location.id !== saved.activeId) activateSavedLocation(location.id);
    confirmLocation(location.id);
    setManual(false);
    setChoosing(false);
    onLocationChanged?.();
  };

  const fillFromPhone = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const fix = await window.electronAPI.getGpsFix();
      if ('status' in fix || fix.source === 'ip') {
        setFailed(true);
        return;
      }
      // Phones move: refresh the one "This phone" entry rather than adding another each time.
      const phoneName = t('locationPrompt.phoneLocationName');
      const storedId = readPhoneLocationId();
      // Without a remembered id (an entry saved before ids were kept), adopt a movable entry with
      // the phone's name rather than adding a second one.
      const existing =
        saved.locations.find((l) => l.id === storedId) ??
        (storedId == null
          ? saved.locations.find((l) => !l.fixed && l.name === phoneName)
          : undefined);
      if (existing) {
        rememberPhoneLocationId(existing.id);
        updateSavedLocation(existing.id, { lat: fix.lat, lon: fix.lon });
        selectLocation({ ...existing, lat: fix.lat, lon: fix.lon });
        return;
      }
      const created = saveNewLocation({
        name: phoneName,
        lat: fix.lat,
        lon: fix.lon,
        fixed: false,
      });
      rememberPhoneLocationId(created.id);
      selectLocation(created);
    } catch (e) {
      console.debug('[mobile/SetLocationCard] phone location failed ' + errLikeToLogString(e));
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-card border border-orange-500/40 bg-orange-500/10 px-4 py-3"
    >
      <div className="flex items-start gap-2.5">
        <MapPin aria-hidden size={16} className="mt-0.5 h-4 w-4 shrink-0 text-orange-400" />
        <div className="min-w-0 flex-1 space-y-2">
          <h3 id={headingId} className="text-body font-medium text-orange-200">
            {confirming
              ? t('locationPrompt.titleConfirm', { name: savedLocationDisplayName(active, t) })
              : t(
                  trust === 'approximate'
                    ? 'locationPrompt.titleApproximate'
                    : 'locationPrompt.titleUnknown',
                )}
          </h3>
          <p className="text-body text-orange-200">
            {confirming
              ? t('locationPrompt.bodyConfirm', {
                  coords: formatCoordPair(active.lat, active.lon, coordinateFormat),
                })
              : t('locationPrompt.bodyUnknownPhone')}
          </p>
          {variant === 'diagnostics' && (
            <p className="text-label text-orange-300">{t('locationPrompt.diagnosticsPaused')}</p>
          )}
          {confirming ? (
            <>
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
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => {
                    void fillFromPhone();
                  }}
                  aria-label={t('locationPrompt.usePhoneLocation')}
                  className={buttonClassName('secondary', 'sm')}
                >
                  {t('locationPrompt.usePhoneLocation')}
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
                    setFailed(false);
                    setChoosing(true);
                  }}
                  aria-label={t('locationPrompt.newLocation')}
                  className={buttonClassName('ghost', 'sm')}
                >
                  {t('locationPrompt.newLocation')}
                </button>
              </div>
              {failed && (
                <p role="alert" className="text-label text-orange-300">
                  {t('locationPrompt.phoneLocationFailed')}
                </p>
              )}
            </>
          ) : manual ? (
            <SavedLocationForm
              approximatePosition={trust === 'approximate' ? ourPosition : null}
              onSaved={selectLocation}
              onCancel={() => {
                setManual(false);
              }}
            />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  aria-busy={busy}
                  onClick={() => {
                    void fillFromPhone();
                  }}
                  aria-label={t('locationPrompt.usePhoneLocation')}
                  className={buttonClassName('primary', 'sm')}
                >
                  {t('locationPrompt.usePhoneLocation')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFailed(false);
                    setManual(true);
                  }}
                  aria-label={t('locationPrompt.enterManually')}
                  className={buttonClassName('ghost', 'sm')}
                >
                  {t('locationPrompt.enterManually')}
                </button>
                {choosing && (
                  <button
                    type="button"
                    onClick={() => {
                      setFailed(false);
                      setChoosing(false);
                    }}
                    aria-label={t('common.cancel')}
                    className={buttonClassName('ghost', 'sm')}
                  >
                    {t('common.cancel')}
                  </button>
                )}
              </div>
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
              {failed && (
                <p role="alert" className="text-label text-orange-300">
                  {t('locationPrompt.phoneLocationFailed')}
                </p>
              )}
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
