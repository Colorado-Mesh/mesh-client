# Offline maps (`mesh-tiles:` + tile cache)

Developer reference for wilderness / no-WAN basemap caching. Human QA: [troubleshooting.md — Map tab without internet](../troubleshooting.md#map-tab-without-internet-offline--no-wan).

## Layout

| Piece                           | Path                                                               |
| ------------------------------- | ------------------------------------------------------------------ |
| Privileged protocol             | `src/main/offline-maps/protocol.ts` (`mesh-tiles:`)                |
| Disk cache + manifest           | `src/main/offline-maps/tile-cache.ts` under userData `tile-cache/` |
| Region downloader               | `src/main/offline-maps/downloader.ts`                              |
| IPC                             | `src/main/ipc/offline-maps-handlers.ts`                            |
| Caps / tile math                | `src/shared/offlineMaps/tileMath.ts`                               |
| Basemap allowlist + remote URLs | `src/shared/offlineMaps/basemapRegistry.ts`                        |
| Layers UI                       | `src/renderer/components/map/OfflineMapsSection.tsx`               |
| Leaflet URL templates           | `src/renderer/lib/mapBasemapUtils.ts` → `MESH_TILES_URL_TEMPLATES` |
| Elevation / LOS profile         | `src/main/elevation/` + `src/main/ipc/elevation-handlers.ts`       |
| Elevation cache (samples + HGT) | `userData/elevation-cache/`                                        |

## Terrain elevation (LOS profile)

- **Online samples:** `elevation:sampleProfile` batches Open-Meteo `/v1/elevation` (same allowlisted host as weather) and caches rounded lat/lon points in `elevation-cache/samples.json`.
- **Offline DEM:** Layers → Offline maps → **Offline elevation (DEM)** downloads Mapzen/AWS skadi SRTM1 `.hgt.gz` tiles for the current viewport into `elevation-cache/hgt/`. Profiles prefer HGT, then sample cache, then network.
- **UI:** `TerrainProfileControl` / `TerrainProfileOverlay` on `MeshMapShell` (all protocols). Fresnel math lives in `src/shared/elevation/profileMath.ts`.

## Behavior invariants

- **Cache-on-view:** online `mesh-tiles:` misses fetch OSM/USGS with timeout, then `putCachedTile`. Offline miss → 404 (blank tile).
- **Region download:** USGS Topo only; OpenStreetMap standard tiles prohibit bulk download and prefetch, so both `osm` and `dark` disable download/auto-cache controls and the main-process downloader rejects requests before starting a job. For permitted sources: estimate → confirm → job with concurrency; pauses when `net.isOnline()` is false; resumes after ~60s stable online. Cancel combines job abort with per-tile fetch timeout (`AbortSignal.any`).
- **Basemaps (built-in):** allowlist is `osm`, `dark`, `usgs-topo` (`OFFLINE_MAP_BASEMAP_IDS`); unknown built-in ids are rejected by the protocol, cache, and IPC. Attribution strings live in `BASEMAP_ATTRIBUTIONS`. **Custom map sources** (user-confirmed XYZ templates and imported MBTiles) are a separate `MapSourceId` path — see [Custom sources](#custom-sources) below; they are not part of the built-in allowlist and do not get USGS region download.
- **USGS topo:** remote is the National Map ArcGIS `USGSTopo/MapServer/tile/{z}/{y}/{x}` (row before column — `buildRemoteTileUrl` swaps; `mesh-tiles:` URLs stay `{z}/{x}/{y}`). US coverage only; cached tiles stop at z16 (`USGS_TOPO_MAX_NATIVE_ZOOM` → Leaflet `maxNativeZoom`), so region downloads above z16 count as failed tiles. Tiles are JPEG stored under a `.png` cache filename (Chromium sniffs image bytes). No retina variant.
- **Dark OpenStreetMap:** `dark` uses the canonical `https://tile.openstreetmap.org/{z}/{x}/{y}.png` raster source with a tile-only CSS filter (`mesh-basemap-dark`). Labels stay in the raster tiles; markers, trails, attribution, and controls are not filtered. No API key or extra map engine is needed. Normal viewport caching is retained. See the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- **Source changes:** the dark URL includes `?source=osm-v1` to bypass Chromium's old CARTO image cache. Dark disk tiles live under `dark/osm-v1/`, so cached CARTO key-error images cannot be reused. Existing files and saved-region metadata are retained and remain subject to the normal cache limit. Existing dark regions need to be viewed online to fill the replacement source.
- **Retina:** current sources have no `@2x` variant. Legacy retina URLs remain parseable, but new UI requests use standard tiles.
- **Caps:** single-job estimate must stay ≤ `OFFLINE_MAP_MAX_ESTIMATE_BYTES` (= 50% of `TILE_CACHE_MAX_BYTES`, ~1 GiB LRU) and ≤ `OFFLINE_MAP_MAX_TILES` so a completed region is not immediately LRU-evicted.
- **Manifest:** atomic write (temp + rename); serialized `mutateManifest`; in-memory byte/source counts (single-flight `ensureStats`); full tree scan only when over budget for eviction (shared in-flight pass down to ~90% low-water); debounced source-stat persist.
- **IPC validation:** finite lat/lon (lat ∈ [-90,90], \|lon\| ≤ 360), finite zooms; reject inverted north/south.

## Custom sources

User-confirmed XYZ tile servers and imported MBTiles packages. Operator guide: [Maps — Custom map sources](../maps.md#custom-map-sources).

| Piece                        | Path                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared validation + caps     | `src/shared/offlineMaps/customMapSources.ts` (`CUSTOM_MAP_SOURCES_MAX = 16`, `CUSTOM_SOURCE_CACHE_MAX_BYTES` 256 MiB/XYZ, `MBTILES_MAX_BYTES` 2 GiB, `CUSTOM_TILE_MAX_BYTES` 2 MiB) |
| Main allowlist / persistence | `src/main/offline-maps/custom-sources.ts`, `custom-sources-service.ts`                                                                                                              |
| MBTiles reader               | `src/main/offline-maps/mbtiles.ts`                                                                                                                                                  |
| Protocol fetch               | `src/main/offline-maps/protocol.ts` (`buildCustomRemoteTileUrl`; host is source id only)                                                                                            |
| IPC                          | `src/main/ipc/offline-maps-handlers.ts`                                                                                                                                             |
| UI                           | `src/renderer/components/map/CustomMapSourcesSection.tsx` (under Offline maps)                                                                                                      |

**Security model:** the renderer never supplies a remote host. XYZ templates are validated once (`validateXyzTemplate`: HTTPS, public hostname, no credentials, no OSM host), persisted only after `confirmed: true`, and only `{z}/{x}/{y}` are substituted at fetch time. Public `CustomMapSourceInfo` may include the confirmed host for XYZ, never the full template.

**Behaviour:** custom XYZ caches **viewed tiles only** (no USGS-style region download / auto-cache). MBTiles packages are imported to disk and served offline with zoom range from the package metadata. Per-source cache budget and global source count are enforced in main. Tests: `customMapSources.test.ts`, `custom-sources*.test.ts`, related protocol/cache tests.

## LoRa weather forecasts

Forecast circles are a separate map layer (`WeatherForecastLayer`), drawn on every map. They are not part of the tile cache. Marked Meshtastic and MeshCore weather bots are parsed in the renderer; place names are resolved with the bundled gazetteer and, when that misses, Open-Meteo. Each forecast stays for 12 hours from local receive time (`WEATHER_FORECAST_MAX_AGE_MS`), then drops off.

## Update footer (related)

Quiet offline update checks live in `src/main/updater.ts` + App subscriptions. Network-class failures use `isNetworkClassFailure` (walks nested `cause` / `code`). UI keeps **ready** (update already downloaded) when going offline; otherwise shows muted offline. Main `update:offline` while `navigator.onLine` still schedules the 60s online-recovery check.
