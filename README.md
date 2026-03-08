# Mesh-Client

> A cross-platform Meshtastic desktop client for **Mac**, **Linux**, and **Windows** — built for power users who need more than a mobile app.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey)
![Build Status](https://img.shields.io/github/actions/workflow/status/Colorado-Mesh/meshtastic-client/ci.yaml?branch=main)

---

## Why

The official Meshtastic apps cover the basics, but desktop power users need more: persistent message history, mesh diagnostics, MQTT integration, and keyboard-driven workflows. Mesh-Client fills that gap — a full-featured desktop client built on Electron with a local SQLite database, routing diagnostics, and multi-transport connectivity.

---

## Visuals

<details>
<summary>Screenshots</summary>

<table>
  <tr>
    <td><img src="docs/images/node-list.png" height="200" alt="Node List"/></td>
    <td><img src="docs/images/map.png" height="200" alt="Map"/></td>
    <td><img src="docs/images/diagnostics.png" height="200" alt="Diagnostics"/></td>
    <td><img src="docs/images/node-detail.png" height="200" alt="Node Detail"/></td>
  </tr>
</table>

</details>

---

## Key Features

**Connectivity**
- **Bluetooth LE** — pair wirelessly; one-click reconnect card remembers your last device (name persists across sessions)
- **USB Serial** — plug in via USB; auto-reconnects silently on startup
- **WiFi/HTTP** — connect to network-enabled nodes; saves last address for quick reconnect
- **MQTT** — subscribe to a broker to receive mesh traffic over the internet; AES-128-CTR decryption, automatic RF deduplication, exponential-backoff reconnect

**Chat**
- Send/receive messages across channels with ACK/NAK delivery indicators
- Emoji reactions (11 emojis with compose picker) and reply-to-message (quoted preview in bubble)
- Unread message divider that persists across restarts and auto-scrolls on tab switch
- Direct messages (DMs) to individual nodes

**Node Management**
- Node list with SNR, RSSI, battery, GPS, last heard, and packet redundancy score
- Distance filter, favorite/pin nodes, device role icons, signal strength bars
- Node Detail Modal: DM, trace route with hop-path display, delete node, Routing Health section with 24-hour sparkline, Connection Health %, and collapsible Path History

**Radio & Channel Configuration**
- Edit channels: name, PSK, and role; 18 region presets and 7 modem presets
- Device roles: Client, Router, Tracker, Sensor, TAK, and more
- Per-channel MQTT gateway uplink/downlink; device reboot, shutdown, and factory reset

**Diagnostics**
- Network health score (0–100) and searchable anomaly table
- Routing anomaly detection: hop_goblin (over-hopping), bad_route (high duplicates), route_flapping, impossible_hop — with remediation suggestions and severity levels
- Anomaly badges inline in node list; status aura circles on the map
- Congestion halos toggle; global and per-node MQTT ignore for fine-grained routing analysis

**Map & Telemetry**
- Interactive OpenStreetMap with node positions and your current location
  (device GPS → browser geolocation → IP-based city-level fallback)
  — auto-refresh at configurable intervals; send your position back to your device
- Battery voltage and signal quality charts (Recharts)

**Productivity**
- Full keyboard navigation — press `?` for shortcut reference; `Cmd/Ctrl+1–8` switches tabs; `Cmd/Ctrl+F` searches chat
- Automatic update checking — packaged builds download and install in-app; macOS opens the release page
- System tray with live unread badge; app stays accessible when window is closed
- Persistent storage via local SQLite; DB export/import/clear in the App tab

---

## Quick Start

**Prerequisites:**
- Node.js 20+ (LTS) and npm 9+
- Native build tools (for SQLite) — see platform notes below
- A Meshtastic device (any hardware running Meshtastic firmware)

### Mac & Linux

```bash
git clone https://github.com/Colorado-Mesh/meshtastic-client
cd meshtastic-client
npm install
npm start
```

<details>
<summary>Mac — extra notes</summary>

Install Xcode Command Line Tools if `npm install` fails:
```bash
xcode-select --install
```

On first Bluetooth connection, macOS shows a system popup requesting Bluetooth permission — you must accept. If you accidentally denied it, go to **System Settings > Privacy & Security > Bluetooth** and toggle Mesh-Client on.
</details>

<details>
<summary>Linux — extra notes</summary>

Install build tools:
```bash
# Debian/Ubuntu
sudo apt install build-essential python3

# Fedora/RedHat
sudo dnf groupinstall "Development Tools" && sudo dnf install python3
```

**Building distributables:**

On Debian/Ubuntu, to also build `.rpm` packages you need the `rpm` package:
```bash
sudo apt install rpm
```

On Fedora/RedHat, building `.deb` packages is not easily supported. Use these targets instead:
```bash
npm run dist:linux -- --linux rpm
npm run dist:linux -- --linux appimage
```

BLE requires BlueZ (the standard Linux Bluetooth stack, included in most distros).

**Sandbox issues (dev mode or AppImage):**

Some Linux configurations require disabling Electron's sandbox. If the app fails to launch, try:
```bash
npm run dev -- --no-sandbox        # dev mode
./MeshClient.AppImage --no-sandbox # AppImage
```

For serial access, add yourself to the `dialout` group (then log out and back in):
```bash
sudo usermod -a -G dialout $USER
```

**ARM architecture (Raspberry Pi, etc.) — additional requirements:**

Install these extra libraries before running in development mode:
```bash
sudo apt install zlib1g-dev libfuse2
```

Electron's sandbox requires elevated privileges on ARM. Either grant sandbox permissions:
```bash
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

Or launch with the no-sandbox flag:
```bash
npm run dev -- --no-sandbox
# or
electron . --no-sandbox
```
</details>

<details>
<summary>Windows — extra notes</summary>

**1. Install prerequisites** (if not already):
```powershell
winget install git.git
winget install openjs.nodejs
```

**2. Allow npm scripts:**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**3. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)** with the "Desktop development with C++" workload (required for native SQLite).

**4. Clone and run:**
```bash
git clone https://github.com/Colorado-Mesh/meshtastic-client
cd meshtastic-client
npm install
npm start
```

If serial isn't detected, install the correct USB drivers for your device (CP210x or CH340).
</details>

---

## Usage

### Connecting Your Device

1. Power on your Meshtastic device
2. Put it in Bluetooth pairing mode (if connecting via BLE)
3. Open Mesh-Client and go to the **Connection** tab
4. Select your connection type (Bluetooth / USB Serial / WiFi / MQTT)
5. Click **Connect** and select your device from the picker
6. Wait for status to show **Configured** — you're connected

### Auto-Reconnect

After a successful connection, Mesh-Client remembers your last device. On next launch:
- **Serial** — auto-connects silently in the background
- **Bluetooth / WiFi** — a one-click reconnect card appears; click **Reconnect** (BLE requires a user gesture)
- **MQTT** — auto-reconnects using saved broker settings

### MQTT

Enter your broker URL, topic, and optional credentials in the MQTT section of the Connection tab. When connected, the section collapses to a compact info card showing the server, client ID, and topic. You can send messages via MQTT even when no hardware device is connected.

---

## Configuration

### Connection Types

| Platform | Bluetooth | Serial | HTTP | MQTT |
|----------|-----------|--------|------|------|
| macOS    | Yes       | Yes    | Yes  | Yes  |
| Windows  | Yes       | Yes    | Yes  | Yes  |
| Linux    | Yes       | Yes    | Yes  | Yes  |

### Tech Stack

| Component  | Technology                                |
|------------|-------------------------------------------|
| Desktop    | Electron                                  |
| UI         | React 19 + TypeScript                     |
| Styling    | Tailwind CSS v4                           |
| Meshtastic | @meshtastic/core (JSR)                    |
| Maps       | Leaflet + OpenStreetMap                   |
| Charts     | Recharts                                  |
| Database   | SQLite (better-sqlite3)                   |
| Build      | esbuild + Vite + electron-builder         |

### Project Structure

```
src/
├── main/           # Electron main process (window, BLE handler, SQLite, MQTT manager)
├── preload/        # Context bridge (IPC)
└── renderer/       # React app
    ├── components/ # All UI panels (Chat, Nodes, Map, Radio, App, Diagnostics, etc.)
    ├── hooks/      # useDevice — Meshtastic device state management
    ├── stores/     # Zustand stores (diagnostics state)
    └── lib/        # Transport setup, TypeScript types, diagnostics engines, GPS resolution
```

---

## Building a Distributable

```bash
npm run dist:mac      # macOS → .dmg + .zip in release/
npm run dist:linux    # Linux → .AppImage + .deb in release/
npm run dist:win      # Windows → .exe installer in release/
```

Output goes to the `release/` directory.

---

## Contributing / Development

To run in development mode with hot reload:

```bash
npm run dev
```

This starts the Vite dev server, watches main/preload for changes, and launches Electron automatically. For the best experience, install [React DevTools](https://react.dev/link/react-devtools).

See [CONTRIBUTING.md](CONTRIBUTING.md) for coding conventions, branch workflow, and PR guidelines.

---

## Troubleshooting

### `npm install` fails on native module compilation

You're missing build tools for the native SQLite module:
- **Mac**: `xcode-select --install`
- **Linux**: `sudo apt install build-essential python3`
- **Windows**: Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload

### BLE connection fails with "Connection attempt failed"

- Make sure your device has Bluetooth enabled and is in pairing mode
- On macOS: check **System Settings > Privacy & Security > Bluetooth**
- Try disconnecting fully first, then reconnecting
- If the device picker never appears, restart the app

### Serial port not detected

- Ensure USB drivers are installed for your device (CP210x, CH340, etc.)
- On Linux, add yourself to the `dialout` group: `sudo usermod -a -G dialout $USER`

### App crashes on launch (macOS distributable)

- This may be a native module signing issue — try rebuilding: `npm run dist:mac`
- If building from source: make sure `npm install` completed without errors

### App shows "disconnected" but device is still on

- The Bluetooth connection can drop silently — click Disconnect, then Connect again
- For serial: the USB cable may have been bumped — reconnect

### Permission messages in the console

`[permissions] checkHandler: media → denied` and `web-app-installation → denied` are expected. The app only uses **serial** and **geolocation** — media and web-app-installation are intentionally denied.

### `[DEP0169]` / `url.parse()` deprecation warning

The app uses npm package overrides to force `follow-redirects` and `cacheable-request` onto versions that use the WHATWG URL API, which removes this warning. To trace the source of any deprecation, run:
```bash
npm run trace-deprecation
```

---

## License

MIT — see [LICENSE](LICENSE)

## Credits

See [CREDITS.md](CREDITS.md). Created by **[Joey (NV0N)](https://github.com/rinchen)** & **[dude.eth](https://github.com/defidude)**. Based on the [original Mac client](https://github.com/Colorado-Mesh/meshtastic_mac_client). Part of **[Colorado Mesh](https://github.com/Colorado-Mesh/meshtastic-client)**.
