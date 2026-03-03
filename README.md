# Mesh-Client

A cross-platform Meshtastic desktop client for **Mac**, **Linux**, and **Windows**.

Connect to your Meshtastic devices over Bluetooth, USB Serial, or WiFi. Independently, you can connect directly to MQTT.

> Created by **[Joey (NV0N)](https://github.com/rinchen)** & **[dude.eth](https://github.com/defidude)**. Based on the [original Mac client](https://github.com/Denver-Mesh/meshtastic_mac_client). Part of [**Denver Mesh**](https://github.com/Denver-Mesh/meshtastic-client).

---

## Setup

### Prerequisites

- **Node.js 20+** (LTS recommended — [download here](https://nodejs.org/))
- **npm 9+** (included with Node.js)
- **Build tools** for compiling the native SQLite module:
  - **Mac**: Xcode Command Line Tools — run `xcode-select --install`
  - **Linux**: `sudo apt install build-essential python3` (Debian/Ubuntu)
  - **Windows**: [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload
- A Meshtastic device (any hardware running Meshtastic firmware)
- **For development**: [React DevTools](https://react.dev/link/react-devtools) browser extension

### Mac

```bash
git clone https://github.com/Denver-Mesh/meshtastic-client
cd meshtastic-client
npm install
npm start
```

> **Note:** `npm install` automatically compiles the native SQLite module for Electron. If it fails, make sure Xcode Command Line Tools are installed.

On first Bluetooth connection, macOS will show a system popup requesting Bluetooth permission — you must accept. If you accidentally denied it, go to **System Settings > Privacy & Security > Bluetooth** and toggle Mesh-Client on.

### Linux

```bash
git clone https://github.com/Denver-Mesh/meshtastic-client
cd meshtastic-client
npm install
npm start
```

BLE requires BlueZ installed. If Bluetooth doesn't work, try launching with `--enable-features=WebBluetooth`. For serial access, add yourself to the `dialout` group:

```bash
sudo usermod -a -G dialout $USER
# Then log out and back in
```

### Windows

```bash
git clone https://github.com/Denver-Mesh/meshtastic-client
cd meshtastic-client
npm install
npm start
```

Should work out of the box. If serial isn't detected, make sure you have the correct USB drivers for your device (e.g., CP210x or CH340 drivers).

---

## Connecting Your Device

1. **Power on** your Meshtastic device
2. **Put it in Bluetooth pairing mode** (if connecting via BLE)
3. Open Mesh-Client and go to the **Connection** tab
4. Select your connection type (Bluetooth / USB Serial / WiFi / MQTT)
5. Click **Connect** and select your device from the picker
6. Wait for status to show **Configured** — you're connected!

For **MQTT**, enter your broker URL, topic, and optional credentials in the MQTT section of the Connection tab. When connected, the section collapses to a compact info card showing the server, client ID, and topic.

---

## Development

To run the app in development mode with hot reload:

```bash
npm run dev
```

This starts the Vite dev server, watches the main/preload processes for changes, and launches Electron automatically.

For the best development experience, install [React DevTools](https://react.dev/link/react-devtools).

---

## Building the Distributable

```bash
# Build for your platform
npm run dist:mac      # macOS → .dmg + .zip in release/
npm run dist:linux    # Linux → .AppImage + .deb in release/
npm run dist:win      # Windows → .exe installer in release/
```

The distributable is output to the `release/` directory.

---

## Features

- **Bluetooth LE** — pair wirelessly with nearby Meshtastic devices
- **USB Serial** — plug in via USB cable
- **WiFi/HTTP** — connect to network-enabled nodes
- **MQTT** — subscribe to a Meshtastic MQTT broker to receive mesh traffic over the internet; send messages via MQTT even when no hardware device is connected; AES-128-CTR encryption/decryption, automatic deduplication with RF, and exponential-backoff reconnect
- **Chat** — send/receive messages across channels with delivery indicators (ACK/NAK), emoji reactions (11 emojis with compose picker), reply-to-message (hover to reply; quoted preview shown in bubble), and an unread message divider that persists across restarts and scrolls you to where you left off
- **Channel Management** — create and configure channels with custom names and PSK encryption
- **Node List** — all discovered nodes with SNR, RSSI signal strength, battery, GPS, last heard; distance filter hides nodes beyond a configurable range; favorite/pin nodes for quick access
- **Signal Strength Indicators** — live RSSI bars on nodes and in chat, color-coded by signal quality
- **Device Role Display** — visual icons and badges for each node's configured role (Router, Client, Repeater, etc.)
- **Node Detail Modal** — click any node or sender name for full info; send a DM, run a trace route with hop-path display, or delete the node; GPS warning banner shown when a node has reported invalid coordinates; Routing Health section with active anomaly description and 24-hour hop-count sparkline
- **Diagnostics** — tab 8 (Cmd/Ctrl+8): network health score badge (0–100), searchable anomaly table with per-node trace-route action, and remediation suggestions (antenna mismatch, RF noise, MQTT ghost, config issues); anomaly badges (⚠) shown inline in the node list; status aura circles on the map; congestion halos toggle; Ignore MQTT checkbox filters MQTT-only nodes from routing analysis and dims them in the node list
- **Map** — interactive OpenStreetMap with node positions; distance filter matches the node list
- **Telemetry** — battery voltage and signal quality charts
- **Radio** — region, modem preset, device role, GPS, power, Bluetooth, display settings
- **App** — reboot, shutdown, factory reset, node retention controls, channel-scoped message deletion, DB export/import/clear; map & node distance filter; prune nodes by location
- **System Tray** — tray icon with live unread message badge; app stays accessible when window is closed
- **Persistent Storage** — messages and nodes saved locally via SQLite
- **Dark UI** — custom scrollbar, tab icons, polished chat bubbles

---

## Connection Types

| Platform | Bluetooth | Serial | HTTP | MQTT |
|----------|-----------|--------|------|------|
| macOS    | Yes       | Yes    | Yes  | Yes  |
| Windows  | Yes       | Yes    | Yes  | Yes  |
| Linux    | Partial   | Yes    | Yes  | Yes  |

---

## Tech Stack

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

---

## Project Structure

```
src/
├── main/           # Electron main process (window, BLE handler, SQLite, MQTT manager)
├── preload/        # Context bridge (IPC)
└── renderer/       # React app
    ├── components/ # All UI panels (Chat, Nodes, Map, Radio, App, Diagnostics, etc.)
    ├── hooks/      # useDevice — Meshtastic device state management
    ├── stores/     # Zustand stores (diagnostics state)
    └── lib/        # Transport setup, TypeScript types, diagnostics engines
```

---

## Troubleshooting

### `npm install` fails on native module compilation

You're missing build tools for compiling the native SQLite module:
- **Mac**: `xcode-select --install`
- **Linux**: `sudo apt install build-essential python3`
- **Windows**: Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload

### BLE connection fails with "Connection attempt failed"

- Make sure your device has Bluetooth enabled and is in **pairing mode**
- On macOS: Check **System Settings > Privacy & Security > Bluetooth**
- Try disconnecting fully first, then reconnecting
- If the device picker never appears, restart the app

### Serial port not detected

- Ensure your USB drivers are installed for your device (CP210x, CH340, etc.)
- On Linux, add yourself to the `dialout` group: `sudo usermod -a -G dialout $USER`

### App crashes on launch (macOS distributable)

- This may be a native module signing issue — try rebuilding: `npm run dist:mac`
- If building from source: make sure `npm install` completed without errors

### App shows "disconnected" but device is still on

- The Bluetooth connection can drop silently. Click Disconnect, then Connect again
- For serial: the USB cable may have been bumped — reconnect

---

## License

MIT — see [LICENSE](LICENSE)

## Credits

See [CREDITS.md](CREDITS.md). Created by **[Joey (NV0N)](https://github.com/rinchen)** & **[dude.eth](https://github.com/defidude)**. Based on the [original Mac client](https://github.com/Denver-Mesh/meshtastic_mac_client). Part of **[Denver Mesh](https://github.com/Denver-Mesh/meshtastic-client)**.
