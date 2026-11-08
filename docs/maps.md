# Maps and offline maps

The **Map** tab shows node positions, emergency incidents, weather forecasts, sensor values, and (on Reticulum) RMAP discovery interfaces on a shared basemap. This guide covers basemaps, overlays, custom tile sources, offline caching, your own position, SAR tools, and the protocol differences that matter on the map. For wilderness / no-WAN QA, see [Troubleshooting — Map tab without internet](troubleshooting.md#map-tab-without-internet-offline--no-wan). Developer tile-cache detail lives in [Offline maps](development/offline-maps.md).

---

## Basemaps

Open **Layers** on the Map tab and choose under **Basemap**:

| Label in the app          | Notes                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| **OpenStreetMap (light)** | Default. Viewed tiles are cached; OpenStreetMap does not allow bulk prefetch or region download.        |
| **Dark (OpenStreetMap)**  | Same OSM raster tiles with a local CSS filter — no API key. Same view-cache rules as the light basemap. |
| **USGS Topo (US only)**   | United States coverage from the National Map. Native zoom stops at 16 (Leaflet overzooms above that).   |

Basemap choice is remembered. Built-in remotes always go through the privileged `mesh-tiles:` protocol; the renderer never supplies a host for them.

---

## Layers and overlays

Under **Overlays** you can toggle:

- **Node markers** — heard nodes with coordinates
- **Movement trails** — recent position history
- **Waypoints** — Meshtastic waypoints when the protocol provides them
- **Emergency incidents** — open MECP rows with coordinates (all three protocols)
- **MGRS grid** — search-and-rescue grid (off by default)
- **Weather forecasts** — parsed forecast circles from marked weather bots
- **Sensors** — temperature / humidity / pressure from telemetry
- **TAK units** — contacts from the local TAK gateway and remote relay
- Diagnostic **Route weights**, **Anomaly halos**, and **Congestion halos** when those engines have data

Overlays are vector layers drawn on top of the basemap. If nodes have latitude/longitude from RF, MQTT, SQLite, or your session, markers and trails can still render when the basemap is blank or only partly cached.

Use **Measure** to click a multi-point distance line on the map (`km` / `mi` total). **Show my location** recenters on your resolved position when one is available.

---

## Custom map sources

**Storage & custom sources** (under Offline maps) lets you add a confirmed XYZ tile server or import an MBTiles package. Caps from the shared validator:

| Cap                    | Value                                    |
| ---------------------- | ---------------------------------------- |
| Max custom sources     | **16**                                   |
| Name                   | up to 60 characters                      |
| Attribution (required) | up to 200 characters                     |
| XYZ URL template       | HTTPS only, up to 2048 characters        |
| Per-XYZ view-cache     | 256 MiB (oldest tiles evicted first)     |
| Single custom tile     | 2 MiB                                    |
| MBTiles import         | 2 GiB max; PNG / JPEG / WebP raster only |
| Max zoom field         | 0–22                                     |

### Add custom XYZ source…

1. Enter a **Name**, an HTTPS **Tile URL** with exactly one `{z}`, `{x}`, and `{y}` after the host, and **Attribution**.
2. Optionally set **Highest zoom the server provides**.
3. Check the confirmation that you may use the host and that attribution is correct, then **Add source**.

Rules enforced before save:

- **HTTPS only** — no `http://`, no credentials in the URL, no custom ports, no IP literals or private/local hostnames.
- OpenStreetMap hosts are rejected — use the built-in basemap instead.
- Tile requests use only a source id (`mesh-tiles:`). Public source metadata may include the confirmed host, but never the raw URL template (so credentials cannot leak to the renderer).

Custom XYZ sources cache **only tiles you view**. Bulk region download and **Auto-cache** are not available for them — import an MBTiles package when you need a large offline area from a custom map.

### Import MBTiles package…

1. Choose a raster MBTiles file; the app inspects format and zoom range.
2. Confirm name, attribution, and permission, then **Import**.
3. The package is **copied into app storage** and served offline with no network fetch.

Vector MBTiles are rejected. Remove a source or **Clear cache** per source from the same section when you no longer need it.

---

## Offline maps

Viewed tiles for built-in and custom sources are written under the app **userData** `tile-cache/` directory (about **1 GiB** LRU across sources). Without internet, uncached areas look blank; cached tiles and overlays still render.

| Control                   | When it applies                                                    |
| ------------------------- | ------------------------------------------------------------------ |
| **Download current view** | **USGS Topo** only — estimate → confirm tile count/size → download |
| **Auto-cache when idle**  | **USGS Topo** only                                                 |
| **Clear tile cache**      | Frees the shared disk cache                                        |
| View-cache only           | OpenStreetMap light/dark and all custom XYZ (no region prefetch)   |

USGS downloads pause when the network drops and resume after about 60 seconds of stable online. A single job is capped so a finished region is not immediately evicted by the LRU. Cancel stops the job. Outside the United States, USGS Topo is blank by design.

---

## Your position

The map resolves “you” in this order:

1. **Device GPS** from the connected radio (only a real non-zero fix counts as device GPS)
2. An active **saved / static** location from **App → GPS / Location**
3. Host / browser geolocation (when **Share my location** is on)
4. City-level **IP** fallback (when sharing is on and WAN is available; offline IP lookup returns immediately with no fix)

**Share my location** controls host GPS lookups and sending your position over the mesh. Radio GPS and saved locations still work locally for the map and distance filters when sharing is off. The app may ask **Still at …?** when a saved location is active. Coordinate format (Decimal Degrees or MGRS) is under the same GPS section.

---

## SAR tools

For search-and-rescue style work on any protocol map:

- **MGRS grid** — Layers → **MGRS grid**. Labels appear when the visible square count stays small enough to read.
- **Measure** — click points for a running distance total in km and mi.
- Bearing and range to another node appear in **Node Detail** when your position is a trusted fix (device or saved), respecting the miles/km setting in App.

Open MECP incidents with coordinates appear under **Emergency incidents**. See [EMCOMM](emcomm.md).

---

## Reticulum Map differences

On the Reticulum tab the Map is a **Discovery map** for opt-in **RMAP v4** interfaces your stack has heard (local view), not the LoRa node-position map.

- Filter by interface kind (LoRa, Backbone, I2P, TCP, Other).
- Markers need GPS on the announcing interface; your App GPS position can show as self.
- There are no Meshtastic/MeshCore movement trails or waypoints on this view.
- **Global map** opens [rmap.world](https://rmap.world/). Publish settings live under Network → RMAP.

Full behaviour: [Reticulum — Map / RMAP](reticulum.md).

---

## Weather forecasts and Sensors

**Weather forecasts** (Layers → **Weather forecasts**) draws circles for forecasts parsed from marked Meshtastic and MeshCore weather senders. Place names use a built-in gazetteer; optional online place lookup is under the weather filter settings. Forecasts expire about 12 hours after local receive time.

**Sensors** (Layers → **Sensors**) plots the latest temperature, humidity, or pressure from nodes that report environment telemetry (including MeshCore Cayenne LPP). Pick the metric from the layer control; sparklines show recent history when available.

---

## Internet weather

Optional **Layers → Internet weather** overlays (default off) fetch live data over HTTPS when you enable them:

| Layer                          | Coverage                                                     | Notes                                                                                               |
| ------------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Point forecast (click the map) | Global                                                       | Open-Meteo current + hourly + 7-day                                                                 |
| Temperature / wind fields      | Global                                                       | Open-Meteo grid samples for the viewport; temperature uses the App Telemetry °C/°F preference       |
| Radar                          | Global (RainViewer); higher detail in CONUS (NEXRAD via IEM) | RainViewer is regional (native zoom ≤ 7). Coverage gaps are normal over oceans and some land areas. |

Data is memory-cached for the session only (no weather disk cache). The map area you are viewing is sent to Open-Meteo and RainViewer (and IEM/NWS for US radar). Attribution appears on the map when layers are active.

Developer reference: [Internet weather](development/internet-weather.md).

---

## Troubleshooting

- [Map tab without internet (offline / no WAN)](troubleshooting.md#map-tab-without-internet-offline--no-wan)
- [Diagnostics and map](troubleshooting.md#diagnostics-and-map)
- [GPS "Location unavailable" or stuck on the map](troubleshooting.md) (GPS section under Diagnostics and map)
- Developer reference: [Offline maps (`mesh-tiles:` + tile cache)](development/offline-maps.md)

### Related

- [EMCOMM: MECP and Incident Command](emcomm.md) — incident markers
- [TAK gateway](tak.md) — TAK units overlay
- [Chat](chat.md) — sharing location from a conversation
- [Settings](settings.md) — GPS, map filters, retention of position history
