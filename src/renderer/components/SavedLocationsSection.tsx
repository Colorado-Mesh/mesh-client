import { Trash2 } from 'lucide-react-motion';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatCoordPair } from '../lib/coordUtils';
import {
  activateSavedLocation,
  deactivateSavedLocation,
  deleteSavedLocation,
  type SavedLocation,
  updateSavedLocation,
  useSavedLocations,
} from '../lib/savedLocations';
import { useCoordFormatStore } from '../stores/coordFormatStore';
import { useLocationPromptStore } from '../stores/locationPromptStore';
import { savedLocationDisplayName, SavedLocationForm } from './SetLocationCard';
import { buttonClassName, IconButton } from './ui/Button';
import { INPUT_BOX_SM_CLASS } from './ui/formClasses';

interface SavedLocationsSectionProps {
  /** Re-resolve our position in the active runtime after the active location changes. */
  onLocationChanged?: () => void;
}

/** App tab management for named locations (Home, EOC, ...) used when the radio has no GPS. */
export default function SavedLocationsSection({ onLocationChanged }: SavedLocationsSectionProps) {
  const { t } = useTranslation();
  const saved = useSavedLocations();
  const confirmLocation = useLocationPromptStore((s) => s.confirmLocation);
  const coordinateFormat = useCoordFormatStore((s) => s.coordinateFormat);
  const [adding, setAdding] = useState(false);

  // Picking a location here is an explicit statement of where the computer is.
  const activate = (location: SavedLocation) => {
    activateSavedLocation(location.id);
    confirmLocation(location.id);
    onLocationChanged?.();
  };

  return (
    <div className="border-ink-700 space-y-2 border-t pt-1">
      <h4 className="text-ink-300 text-body font-medium">{t('locationPrompt.listHeading')}</h4>
      <p className="text-muted text-label leading-relaxed">{t('locationPrompt.listDesc')}</p>
      {saved.locations.length === 0 ? (
        <p className="text-muted text-label">{t('locationPrompt.listEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {saved.locations.map((location) => {
            const isActive = location.id === saved.activeId;
            const displayName = savedLocationDisplayName(location, t);
            return (
              <li
                key={location.id}
                className="border-ink-800 bg-ink-900 rounded-control flex flex-wrap items-center gap-2 border px-2.5 py-2"
              >
                <input
                  type="text"
                  defaultValue={location.name}
                  placeholder={t('locationPrompt.defaultName')}
                  onBlur={(e) => {
                    if (e.target.value.trim() !== location.name) {
                      updateSavedLocation(location.id, { name: e.target.value });
                    }
                  }}
                  aria-label={t('locationPrompt.renameAria', { name: displayName })}
                  className={`${INPUT_BOX_SM_CLASS} w-36`}
                />
                <span className="text-muted text-label min-w-0 flex-1 truncate">
                  {formatCoordPair(location.lat, location.lon, coordinateFormat)}
                </span>
                <label className="text-ink-300 text-label flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={location.fixed === true}
                    onChange={(e) => {
                      updateSavedLocation(location.id, { fixed: e.target.checked });
                    }}
                    aria-label={t('locationPrompt.toggleFixedAria', { name: displayName })}
                    className="accent-brand-green"
                  />
                  {t('locationPrompt.fixedBadge')}
                </label>
                {isActive ? (
                  <span className="text-bright-green text-label font-medium">
                    {t('locationPrompt.active')}
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      activate(location);
                    }}
                    aria-label={t('locationPrompt.useThisAria', { name: displayName })}
                    className={buttonClassName('secondary', 'sm')}
                  >
                    {t('locationPrompt.useThis')}
                  </button>
                )}
                <IconButton
                  icon={<Trash2 aria-hidden size={14} />}
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    deleteSavedLocation(location.id);
                    if (isActive) onLocationChanged?.();
                  }}
                  aria-label={t('locationPrompt.deleteAria', { name: displayName })}
                />
              </li>
            );
          })}
        </ul>
      )}
      {adding ? (
        <SavedLocationForm
          onSaved={(location) => {
            confirmLocation(location.id);
            setAdding(false);
            onLocationChanged?.();
          }}
          onCancel={() => {
            setAdding(false);
          }}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
            aria-label={t('locationPrompt.addLocation')}
            className={buttonClassName('secondary', 'md')}
          >
            {t('locationPrompt.addLocation')}
          </button>
          {saved.activeId != null && (
            <button
              type="button"
              onClick={() => {
                deactivateSavedLocation();
                onLocationChanged?.();
              }}
              aria-label={t('locationPrompt.stopUsing')}
              className={buttonClassName('ghost', 'md')}
            >
              {t('locationPrompt.stopUsing')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
