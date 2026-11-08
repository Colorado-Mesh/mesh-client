import { Layers } from 'lucide-react-motion';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { isValidMapBasemapId } from '@/renderer/lib/mapBasemapUtils';
import { useCustomMapSourcesStore } from '@/renderer/stores/customMapSourcesStore';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
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
  const customSources = useCustomMapSourcesStore((s) => s.sources);
  const ensureCustomSources = useCustomMapSourcesStore((s) => s.ensureLoaded);
  useEffect(() => {
    if (layersPanelOpen && customSources === null) void ensureCustomSources();
  }, [customSources, ensureCustomSources, layersPanelOpen]);
  const showIncidents = useMapLayerStore((s) => s.showIncidents);
  const setShowIncidents = useMapLayerStore((s) => s.setShowIncidents);
  const showMgrsGrid = useMapLayerStore((s) => s.showMgrsGrid);
  const setShowMgrsGrid = useMapLayerStore((s) => s.setShowMgrsGrid);
  const showWeatherForecasts = useMapLayerStore((s) => s.showWeatherForecasts);
  const setShowWeatherForecasts = useMapLayerStore((s) => s.setShowWeatherForecasts);
  const showRadar = useMapLayerStore((s) => s.showRadar);
  const setShowRadar = useMapLayerStore((s) => s.setShowRadar);
  const showWeatherTemperature = useMapLayerStore((s) => s.showWeatherTemperature);
  const setShowWeatherTemperature = useMapLayerStore((s) => s.setShowWeatherTemperature);
  const showWeatherWind = useMapLayerStore((s) => s.showWeatherWind);
  const setShowWeatherWind = useMapLayerStore((s) => s.setShowWeatherWind);

  const weatherEnabled = useInternetWeatherStore((s) => s.enabled);
  const setWeatherEnabled = useInternetWeatherStore((s) => s.setEnabled);
  const radarProvider = useInternetWeatherStore((s) => s.radarProvider);
  const setRadarProvider = useInternetWeatherStore((s) => s.setRadarProvider);
  const tempUnit = useInternetWeatherStore((s) => s.tempUnit);
  const setTempUnit = useInternetWeatherStore((s) => s.setTempUnit);
  const windUnit = useInternetWeatherStore((s) => s.windUnit);
  const setWindUnit = useInternetWeatherStore((s) => s.setWindUnit);
  const precipUnit = useInternetWeatherStore((s) => s.precipUnit);
  const setPrecipUnit = useInternetWeatherStore((s) => s.setPrecipUnit);
  const lastError = useInternetWeatherStore((s) => s.lastError);

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
              {customSources?.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="text-2xs text-ink-400 font-medium">{t('internetWeather.heading')}</div>
            <MapLayerRow
              label={t('internetWeather.enable')}
              checked={weatherEnabled}
              onChange={setWeatherEnabled}
            />
            <p className="text-muted text-2xs">{t('internetWeather.enableHint')}</p>
            {weatherEnabled ? (
              <>
                <MapLayerRow
                  label={t('internetWeather.layerRadar')}
                  checked={showRadar}
                  onChange={setShowRadar}
                />
                <MapLayerRow
                  label={t('internetWeather.layerTemperature')}
                  checked={showWeatherTemperature}
                  onChange={setShowWeatherTemperature}
                />
                <MapLayerRow
                  label={t('internetWeather.layerWind')}
                  checked={showWeatherWind}
                  onChange={setShowWeatherWind}
                />
                {showRadar ? (
                  <label className="text-muted flex flex-col gap-1 text-xs">
                    <span>{t('internetWeather.providerHeading')}</span>
                    <select
                      aria-label={t('internetWeather.providerHeading')}
                      className={`${SELECT_BOX_SM_CLASS} w-full`}
                      value={radarProvider}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'auto' || v === 'rainviewer' || v === 'iem-nexrad') {
                          setRadarProvider(v);
                        }
                      }}
                    >
                      <option value="auto">{t('internetWeather.providerAuto')}</option>
                      <option value="rainviewer">{t('internetWeather.providerRainViewer')}</option>
                      <option value="iem-nexrad">{t('internetWeather.providerNexrad')}</option>
                    </select>
                  </label>
                ) : null}
                <div className="grid grid-cols-1 gap-1">
                  <label className="text-muted flex flex-col gap-1 text-xs">
                    <span>{t('internetWeather.unitsTemp')}</span>
                    <select
                      aria-label={t('internetWeather.unitsTemp')}
                      className={`${SELECT_BOX_SM_CLASS} w-full`}
                      value={tempUnit}
                      onChange={(e) => {
                        if (e.target.value === 'c' || e.target.value === 'f') {
                          setTempUnit(e.target.value);
                        }
                      }}
                    >
                      <option value="c">{t('internetWeather.unitC')}</option>
                      <option value="f">{t('internetWeather.unitF')}</option>
                    </select>
                  </label>
                  <label className="text-muted flex flex-col gap-1 text-xs">
                    <span>{t('internetWeather.unitsWind')}</span>
                    <select
                      aria-label={t('internetWeather.unitsWind')}
                      className={`${SELECT_BOX_SM_CLASS} w-full`}
                      value={windUnit}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === 'kmh' || v === 'mph' || v === 'ms' || v === 'kn') {
                          setWindUnit(v);
                        }
                      }}
                    >
                      <option value="kmh">{t('internetWeather.unitKmh')}</option>
                      <option value="mph">{t('internetWeather.unitMph')}</option>
                      <option value="ms">{t('internetWeather.unitMs')}</option>
                      <option value="kn">{t('internetWeather.unitKn')}</option>
                    </select>
                  </label>
                  <label className="text-muted flex flex-col gap-1 text-xs">
                    <span>{t('internetWeather.unitsPrecip')}</span>
                    <select
                      aria-label={t('internetWeather.unitsPrecip')}
                      className={`${SELECT_BOX_SM_CLASS} w-full`}
                      value={precipUnit}
                      onChange={(e) => {
                        if (e.target.value === 'mm' || e.target.value === 'in') {
                          setPrecipUnit(e.target.value);
                        }
                      }}
                    >
                      <option value="mm">{t('internetWeather.unitMm')}</option>
                      <option value="in">{t('internetWeather.unitIn')}</option>
                    </select>
                  </label>
                </div>
                {lastError?.code === 'offline' ? (
                  <p className="text-2xs text-orange-400">{t('internetWeather.offline')}</p>
                ) : null}
                {lastError && lastError.code !== 'offline' ? (
                  <p className="text-2xs text-orange-400">{t('internetWeather.loadFailed')}</p>
                ) : null}
              </>
            ) : null}
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
