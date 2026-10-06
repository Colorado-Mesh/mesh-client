import { Layers } from 'lucide-react-motion';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { isValidMapBasemapId } from '@/renderer/lib/mapBasemapUtils';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';

import { SELECT_BOX_SM_CLASS } from '../ui/formClasses';
import { MAP_CONTROL_CLASS, MAP_OVERLAY_PANEL_CLASS } from './mapControlClasses';
import { OfflineMapsSection } from './OfflineMapsSection';

export function MapLayerRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (enabled: boolean) => void;
}) {
  return (
    <label className="text-muted flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        className="accent-brand-green"
        checked={checked}
        onChange={(e) => {
          onChange(e.target.checked);
        }}
      />
      {label}
    </label>
  );
}

/**
 * Layers panel shared by every map. Basemap, global overlays, and offline maps are always shown;
 * `extraRows` holds the map's own layer toggles and renders above the global rows.
 */
export function MapLayerControl({ extraRows }: { extraRows?: ReactNode }) {
  const { t } = useTranslation();
  const layersPanelOpen = useMapLayerStore((s) => s.layersPanelOpen);
  const setLayersPanelOpen = useMapLayerStore((s) => s.setLayersPanelOpen);
  const basemapId = useMapLayerStore((s) => s.basemapId);
  const setBasemapId = useMapLayerStore((s) => s.setBasemapId);
  const showIncidents = useMapLayerStore((s) => s.showIncidents);
  const setShowIncidents = useMapLayerStore((s) => s.setShowIncidents);
  const showMgrsGrid = useMapLayerStore((s) => s.showMgrsGrid);
  const setShowMgrsGrid = useMapLayerStore((s) => s.setShowMgrsGrid);
  const showWeatherForecasts = useMapLayerStore((s) => s.showWeatherForecasts);
  const setShowWeatherForecasts = useMapLayerStore((s) => s.setShowWeatherForecasts);

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        type="button"
        aria-label={t('mapPanel.layerControlsAria')}
        aria-expanded={layersPanelOpen}
        className={MAP_CONTROL_CLASS}
        onClick={() => {
          setLayersPanelOpen(!layersPanelOpen);
        }}
      >
        <Layers aria-hidden className="h-3.5 w-3.5" />
        {t('mapPanel.layerControls')}
      </button>
      {layersPanelOpen ? (
        <div className={MAP_OVERLAY_PANEL_CLASS}>
          <div className="space-y-1">
            <div className="text-2xs text-ink-400 font-medium">{t('mapPanel.basemapHeading')}</div>
            <select
              aria-label={t('mapPanel.basemapSelectAria')}
              className={`${SELECT_BOX_SM_CLASS} w-full`}
              value={basemapId}
              onChange={(e) => {
                const v = e.target.value;
                if (isValidMapBasemapId(v)) setBasemapId(v);
              }}
            >
              <option value="dark">{t('mapPanel.basemapDark')}</option>
              <option value="osm">{t('mapPanel.basemapOsm')}</option>
              <option value="usgs-topo">{t('mapPanel.basemapUsgsTopo')}</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <div className="text-2xs text-ink-400 font-medium">{t('mapPanel.layersHeading')}</div>
            {extraRows}
            <MapLayerRow
              label={t('mapPanel.layerIncidents')}
              checked={showIncidents}
              onChange={setShowIncidents}
            />
            <MapLayerRow
              label={t('mapPanel.layerWeatherForecasts')}
              checked={showWeatherForecasts}
              onChange={setShowWeatherForecasts}
            />
            <MapLayerRow
              label={t('mapPanel.layerMgrsGrid')}
              checked={showMgrsGrid}
              onChange={setShowMgrsGrid}
            />
          </div>
          <OfflineMapsSection />
        </div>
      ) : null}
    </div>
  );
}
