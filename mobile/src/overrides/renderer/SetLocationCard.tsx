/**
 * Mobile override of `src/renderer/components/SetLocationCard.tsx`.
 *
 * When the radio reports no GPS (unknown or approximate position), phones offer their own location
 * first: "Use this phone's location" saves and activates a "This phone" location from the native
 * GNSS fix. Saved locations stay one tap away, and "Enter manually" opens the unchanged desktop
 * `SavedLocationForm` (Cancel returns here). Confirming a saved location (`needsConfirm`) renders
 * the unchanged desktop card.
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
import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import {
  activateSavedLocation,
  type SavedLocation,
  saveNewLocation,
  useSavedLocations,
} from '@/renderer/lib/savedLocations';
import { useLocationPromptStore } from '@/renderer/stores/locationPromptStore';

export * from '@/renderer/components/SetLocationCard';

export default function SetLocationCard(props: SetLocationCardProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const saved = useSavedLocations();
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirmLocation = useLocationPromptStore((s) => s.confirmLocation);
  const { ourPosition, trust, variant, onDismiss, onLocationChanged } = props;

  if (trust === 'trusted' || trust === 'needsConfirm') {
    return <DesktopSetLocationCard {...props} />;
  }

  const selectLocation = (location: SavedLocation) => {
    if (location.id !== saved.activeId) activateSavedLocation(location.id);
    confirmLocation(location.id);
    setManual(false);
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
      selectLocation(
        saveNewLocation({
          name: t('locationPrompt.phoneLocationName'),
          lat: fix.lat,
          lon: fix.lon,
          fixed: false,
        }),
      );
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
            {t(
              trust === 'approximate'
                ? 'locationPrompt.titleApproximate'
                : 'locationPrompt.titleUnknown',
            )}
          </h3>
          <p className="text-body text-orange-200">{t('locationPrompt.bodyUnknownPhone')}</p>
          {variant === 'diagnostics' && (
            <p className="text-label text-orange-300">{t('locationPrompt.diagnosticsPaused')}</p>
          )}
          {manual ? (
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
