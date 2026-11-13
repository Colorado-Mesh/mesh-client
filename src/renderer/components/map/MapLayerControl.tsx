import { Layers } from 'lucide-react-motion';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { errLikeToLogString } from '@/renderer/lib/errLikeToLogString';
import { isValidMapBasemapId } from '@/renderer/lib/mapBasemapUtils';
import { useCustomMapSourcesStore } from '@/renderer/stores/customMapSourcesStore';
import { useInternetWeatherStore } from '@/renderer/stores/internetWeatherStore';
import { useMapLayerStore } from '@/renderer/stores/mapLayerStore';
import { useMapOverlayStore } from '@/renderer/stores/mapOverlayStore';
import { useTemperatureUnitStore } from '@/renderer/stores/temperatureUnitStore';

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
  const useFahrenheit = useTemperatureUnitStore((s) => s.useFahrenheit);
  const setUseFahrenheit = useTemperatureUnitStore((s) => s.setUseFahrenheit);
  const windUnit = useInternetWeatherStore((s) => s.windUnit);
  const setWindUnit = useInternetWeatherStore((s) => s.setWindUnit);
  const precipUnit = useInternetWeatherStore((s) => s.precipUnit);
  const setPrecipUnit = useInternetWeatherStore((s) => s.setPrecipUnit);
  const lastError = useInternetWeatherStore((s) => s.lastError);

  const overlayLayers = useMapOverlayStore((s) => s.layers);
  const addOverlayLayer = useMapOverlayStore((s) => s.addLayer);
  const setOverlayVisible = useMapOverlayStore((s) => s.setVisible);
  const setOverlayOpacity = useMapOverlayStore((s) => s.setOpacity);
  const removeOverlayLayer = useMapOverlayStore((s) => s.removeLayer);
  const lastImportError = useMapOverlayStore((s) => s.lastImportError);
  const setImportError = useMapOverlayStore((s) => s.setImportError);
  const [importBusy, setImportBusy] = useState(false);

  const importOverlay = async () => {
    if (importBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const result = await window.electronAPI.mapOverlays.import();
      if (!result.ok) {
        if (result.code === 'cancelled') return;
        setImportError(t(`mapPanel.vectorOverlays.errors.${result.code}`));
        return;
      }
      const added = addOverlayLayer({ name: result.name, geojson: result.geojson });
      if (!added.ok) setImportError(t(`mapPanel.vectorOverlays.errors.${added.code}`));
    } catch (e: unknown) {
      console.warn('[MapLayerControl] overlay import failed ' + errLikeToLogString(e));
      setImportError(t('mapPanel.vectorOverlays.errors.io'));
    } finally {
      setImportBusy(false);
    }
  };

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
                      value={useFahrenheit ? 'f' : 'c'}
                      onChange={(e) => {
                        if (e.target.value === 'c' || e.target.value === 'f') {
                          setUseFahrenheit(e.target.value === 'f');
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

          <div className="space-y-1.5">
            <div className="text-2xs text-ink-400 font-medium">
              {t('mapPanel.vectorOverlays.heading')}
            </div>
            <p className="text-muted text-2xs">{t('mapPanel.vectorOverlays.hint')}</p>
            <button
              type="button"
              aria-label={t('mapPanel.vectorOverlays.importAria')}
              className="border-ink-600 bg-ink-800 text-ink-100 hover:bg-ink-700 rounded-control w-full px-2 py-1 text-xs transition-colors disabled:opacity-50"
              disabled={importBusy}
              onClick={() => {
                void importOverlay();
              }}
            >
              {importBusy
                ? t('mapPanel.vectorOverlays.importing')
                : t('mapPanel.vectorOverlays.import')}
            </button>
            {lastImportError ? (
              <p className="text-2xs text-orange-400" role="status">
                {lastImportError}
              </p>
            ) : null}
            {overlayLayers.map((layer) => (
              <div key={layer.id} className="border-ink-700/60 space-y-1 border-t pt-1.5">
                <MapLayerRow
                  label={layer.name}
                  checked={layer.visible}
                  onChange={(enabled) => {
                    setOverlayVisible(layer.id, enabled);
                  }}
                />
                <label className="text-muted flex flex-col gap-1 text-xs">
                  <span>
                    {t('mapPanel.vectorOverlays.opacity', {
                      value: Math.round(layer.opacity * 100),
                    })}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={5}
                    value={Math.round(layer.opacity * 100)}
                    aria-label={t('mapPanel.vectorOverlays.opacityAria', { name: layer.name })}
                    className="accent-brand-green w-full"
                    onChange={(e) => {
                      setOverlayOpacity(layer.id, Number(e.target.value) / 100);
                    }}
                  />
                </label>
                <button
                  type="button"
                  aria-label={t('mapPanel.vectorOverlays.removeAria', { name: layer.name })}
                  className="text-2xs text-red-400 hover:text-red-300"
                  onClick={() => {
                    removeOverlayLayer(layer.id);
                  }}
                >
                  {t('mapPanel.vectorOverlays.remove')}
                </button>
              </div>
            ))}
          </div>

          <OfflineMapsSection />
        </div>
      ) : null}
    </div>
  );
}
