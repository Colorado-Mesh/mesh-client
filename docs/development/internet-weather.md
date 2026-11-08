# Internet weather (map overlays)

Keyless live weather on the shared map (`MeshMapShell`): Open-Meteo forecasts/grid, RainViewer + CONUS IEM NEXRAD radar. No alert polygons in v1. Opt-in (`internetWeatherEnabled`, default off); session memory cache only.

## Architecture

- Renderer never supplies hosts/URLs. IPC: `weather:pointForecast`, `weather:grid`, `weather:radarFrames`, `weather:clearMemoryCache`.
- Raster tiles via privileged `mesh-weather:` (allowlisted upstream hosts, pinned public DNS, bounded body, `cache-control: no-store`).
- CSP: `img-src` includes `mesh-weather:`; `connect-src` unchanged.

## Providers

| Provider   | Hosts                                            | Use                                                         |
| ---------- | ------------------------------------------------ | ----------------------------------------------------------- |
| Open-Meteo | `api.open-meteo.com`                             | Point forecast + temperature/wind grid (SI)                 |
| RainViewer | `api.rainviewer.com`, `tilecache.rainviewer.com` | Global radar (`maxNativeZoom` 7) + coverage mask            |
| IEM NEXRAD | `mesonet.agron.iastate.edu`                      | CONUS composite when viewport intersects CONUS and zoom ≥ 5 |

Place geocoding for mesh weather-bot posts remains a sibling feature (`geocoding-api.open-meteo.com`); do not merge allowlists.

## Key paths

| Area                            | Path                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Shared types / grid / units     | `src/shared/weather/`                                                                                 |
| Main fetch / protocol / service | `src/main/weather/`                                                                                   |
| IPC                             | `src/main/ipc/weather-handlers.ts`                                                                    |
| Renderer layers / popup         | `src/renderer/components/map/Weather*.tsx`, `RadarLayer.tsx`, `TemperatureLayer.tsx`, `WindLayer.tsx` |
| Hook                            | `src/renderer/hooks/useInternetWeather.ts`                                                            |

## Security

- Fixed host allowlist; redirects re-validated; `assertIpcSender` on every handler.
- No upstream bodies in IPC errors; logs sanitized.
- Coordinate rounding to 2 decimals on outbound point/grid requests.
