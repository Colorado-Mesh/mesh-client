# Offline maps (`mesh-tiles:` + tile cache)

Agent reference for wilderness / no-WAN basemap caching. Human QA: [troubleshooting.md — Map tab without internet](../troubleshooting.md#map-tab-without-internet-offline--no-wan).

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

## Behavior invariants

- **Cache-on-view:** online `mesh-tiles:` misses fetch OSM/Carto with timeout, then `putCachedTile`. Offline miss → 404 (blank tile).
- **Region download:** estimate → confirm → job with concurrency; pauses when `net.isOnline()` is false; resumes after ~60s stable online. Cancel combines job abort with per-tile fetch timeout (`AbortSignal.any`).
- **Retina:** CARTO dark `@2x` only when the renderer passes `retina: true` (`devicePixelRatio > 1`). OSM ignores retina. Cache keys include `@2x` filename when set.
- **Caps:** single-job estimate must stay ≤ `OFFLINE_MAP_MAX_ESTIMATE_BYTES` (= 50% of `TILE_CACHE_MAX_BYTES`, ~1 GiB LRU) and ≤ `OFFLINE_MAP_MAX_TILES` so a completed region is not immediately LRU-evicted.
- **Manifest:** atomic write (temp + rename); serialized `mutateManifest`; in-memory byte/source counts (single-flight `ensureStats`); full tree scan only when over budget for eviction (shared in-flight pass down to ~90% low-water); debounced source-stat persist.
- **IPC validation:** finite lat/lon (lat ∈ [-90,90], \|lon\| ≤ 360), finite zooms; reject inverted north/south.

## Update footer (related)

Quiet offline update checks live in `src/main/updater.ts` + App subscriptions. Network-class failures use `isNetworkClassFailure` (walks nested `cause` / `code`). UI keeps **ready** (update already downloaded) when going offline; otherwise shows muted offline. Main `update:offline` while `navigator.onLine` still schedules the 60s online-recovery check.
