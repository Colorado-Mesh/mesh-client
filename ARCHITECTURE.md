# Architecture

This document describes the project structure, code placement guidelines, and data flow for AI-assisted development.

---

## Directory Tree

```
mesh-client/
├── .github/
│   ├── workflows/                # CI and release (ci.yaml, release.yaml, tests.yaml)
│   ├── ISSUE_TEMPLATE/           # Bug report and feature request templates
│   ├── codeql/                   # CodeQL config
│   └── dependabot.yml
├── @/
│   ├── main/
│   │   ├── index.ts              # Window creation, BLE/Serial intercept, IPC (incl. meshcore TCP & MQTT)
│   │   ├── noble-ble-manager.ts  # BLE via @stoprocent/noble (macOS/Windows); scan/connect IPC
│   │   ├── meshcore-mqtt-adapter.ts  # MeshCore MQTT JSON v1 subscribe/publish
│   │   ├── log-service.ts        # Log file, console patch, log panel IPC
│   │   ├── sanitize-log-message.ts  # Log injection sanitization (CodeQL); use at call sites before appendLine
│   │   ├── database.ts           # SQLite schema & migrations (WAL mode)
│   │   ├── db-compat.ts          # better-sqlite3 API shim over node:sqlite (no node-gyp)
│   │   ├── mqtt-manager.ts       # MQTT client: AES decrypt, dedup, protobuf decode (Meshtastic only)
│   │   ├── updater.ts            # Auto-update checks via electron-updater
│   │   └── gps.ts                # Main-process GPS helper
│   ├── preload/
│   │   └── index.ts              # contextBridge: electronAPI (db, mqtt, log, BLE, serial, session, meshcore.tcp)
│   ├── shared/
│   │   ├── electron-api.types.ts     # IPC / preload API contracts
│   │   ├── meshcoreMqttEnvelope.ts   # JSON v1 envelope parse/validate (main + renderer)
│   │   ├── nodeNameUtils.ts          # Shared node naming helpers
│   │   ├── sqlLikeEscape.ts          # SQL LIKE escape for safe queries
│   │   └── withTimeout.ts            # Shared timeout helper
│   └── renderer/
│       ├── index.html            # HTML entry
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # Shell: 11 tabs Meshtastic / 9 MeshCore (TAK tab) (Security hidden; Modules vs Repeaters), Log panel, shortcuts
│       ├── styles.css            # Global styles, theme variables
│       ├── components/           # Panels and UI (many have co-located *.test.tsx)
│       │   ├── ChatPanel.tsx         # Chat UI, DMs, emoji reactions, channel switching
│       │   ├── SearchModal.tsx       # Cross-channel chat search (`user:` / `channel:` filters)
│       │   ├── NodeListPanel.tsx     # Node & contact list; MeshCore: groups, Import Contacts JSON; online/stale/MQTT
│       │   ├── ContactGroupsModal.tsx # MeshCore: contact group create/edit and members
│       │   ├── SecurityPanel.tsx     # Meshtastic: PKI / admin keys (tab gated by hasSecurityPanel)
│       │   ├── LogAnalyzeModal.tsx   # Log pattern analysis + recommendations
│       │   ├── SnrIndicator.tsx      # SNR quality chip (color by threshold)
│       │   ├── MapPanel.tsx          # Node positions on OpenStreetMap (Leaflet)
│       │   ├── TelemetryPanel.tsx    # Battery/voltage/SNR charts (Recharts)
│       │   ├── ModulePanel.tsx       # Meshtastic: modules tab (telemetry, MQTT, etc.)
│       │   ├── ConnectionPanel.tsx   # BLE/Serial/HTTP/MQTT; protocol toggle; battery gauge; MeshCore contact settings
│       │   ├── DiagnosticsPanel.tsx  # Health band + counts, diagnosticRows table, halos, max age
│       │   ├── MeshCongestionAttributionBlock.tsx  # Shared mesh congestion / duplicate-traffic copy
│       │   ├── LogPanel.tsx          # Live app log, Analyze modal, debug toggle, export/delete log file
│       │   ├── RadioPanel.tsx        # Radio settings, position, GPS send; MeshCore: channels, Import Config JSON
│       │   ├── RepeatersPanel.tsx    # MeshCore: repeater status/trace/neighbors/console (contacts: Nodes tab)
│       │   ├── TakServerPanel.tsx      # TAK server: start/stop, settings, connected clients, data package export
│       │   ├── AppPanel.tsx          # App settings, theme presets, GPS interval, database management
│       │   ├── NodeDetailModal.tsx   # Node info overlay; MeshCore: trace, repeater status, telemetry, neighbors
│       │   ├── NodeInfoBody.tsx      # Shared node info content (modal + map popup)
│       │   ├── KeyboardShortcutsModal.tsx
│       │   ├── UpdateStatusIndicator.tsx # Footer update status
│       │   ├── ErrorBoundary.tsx     # Top-level React error boundary
│       │   ├── SignalBars.tsx        # Signal strength → bars for direct (0-hop) RF only
│       │   ├── RefreshButton.tsx
│       │   ├── Toast.tsx
│       │   └── Tabs.tsx
│       ├── hooks/
│       │   ├── useDevice.ts          # Meshtastic: device lifecycle, 3 transports, auto-reconnect
│       │   ├── useMeshCore.ts        # MeshCore: BLE/Serial/TCP/MQTT, contacts, messages, ACK, trace, telemetry
│       │   ├── useContactGroups.ts   # MeshCore: contact groups state + IPC
│       │   └── useMeshcoreRepeaterRemoteAuth.tsx  # MeshCore: repeater remote auth session flow
│       ├── stores/
│       │   ├── diagnosticsStore.ts   # Anomalies, halo flags, MQTT ignore, foreign LoRa (both protocols)
│       │   ├── mapViewportStore.ts   # Persisted map center/zoom
│       │   ├── positionHistoryStore.ts  # Persisted position trail (1h–7d window, SQLite-backed); path overlay visibility
│       │   └── repeaterSignalStore.ts    # MeshCore: repeater status cache
│       ├── lib/
│       │   ├── types.ts              # MeshNode, ChatMessage, DeviceState, MeshProtocol, etc.
│       │   ├── connection.ts         # Meshtastic: createConnection (BLE/Serial/HTTP)
│       │   ├── serialPortSignature.ts    # Serial port identity persistence for gesture-free reconnect (shared)
│       │   ├── foreignLoraDetection.ts   # Cross-protocol: classify payload, foreign LoRa, RSSI/SNR
│       │   ├── meshcoreUtils.ts      # MeshCore: pubkeyToNodeId, meshcoreContactToMeshNode, contact types
│       │   ├── gpsSource.ts          # GPS waterfall: device → geolocation → null
│       │   ├── nodeStatus.ts         # Node freshness: Meshtastic online <2 h, stale 2 h-7 d, offline >7 d; MeshCore online <48 h, stale 48-96 h, offline >96 h
│       │   ├── coordUtils.ts         # Coordinate conversion helpers
│       │   ├── reactions.ts          # Emoji reaction helpers
│       │   ├── roleInfo.tsx          # Node role display metadata
│       │   ├── signal.ts             # Signal strength → level for SignalBars (direct RF only)
│       │   ├── themeColors.ts        # Theme color helpers
│       │   ├── parseStoredJson.ts    # Safe JSON parse for persisted values
│       │   ├── appSettingsStorage.ts # Renderer app settings persistence helpers
│       │   ├── defaultAppSettings.ts # Default app settings shape
│       │   ├── logAnalyzer.ts        # Heuristic log analysis for connection issues
│       │   ├── repeaterCommandService.ts  # MeshCore: prefix-token CLI command correlation, retry, timeout
│       │   ├── meshcoreRepeaterSession.ts # MeshCore: per-repeater session state helper
│       │   ├── radio/
│       │   │   ├── BaseRadioProvider.ts  # ProtocolCapabilities; MESHTASTIC_CAPABILITIES, MESHCORE_CAPABILITIES
│       │   │   └── providerFactory.ts    # useRadioProvider(protocol) — memoized capabilities
│       │   ├── transport/             # Meshtastic: transport abstraction (used by connection.ts)
│       │   │   ├── TransportManager.ts
│       │   │   └── types.ts
│       │   └── diagnostics/
│       │       ├── RoutingDiagnosticEngine.ts  # Hop anomalies (Meshtastic); protocol-aware
│       │       ├── RFDiagnosticEngine.ts       # RF-layer signal diagnostics
│       │       ├── diagnosticRows.ts           # Row merge/prune, default ages
│       │       ├── meshCongestionAttribution.ts # Path mix + RF originator for congestion copy
│       │       ├── snrMeaningfulForNodeDiagnostics.ts
│       │       └── RemediationEngine.ts        # Suggested fixes for routing + RF rows
│       ├── types/                  # Type declarations (web-serial.d.ts, meshcore.d.ts)
│       └── workers/
│           └── messageEncoder.worker.ts  # Meshtastic: message encoding worker
├── resources/
│   ├── icons/                    # App icons (linux/, mac/, win/)
│   ├── entitlements.mac.plist    # macOS signing entitlements (main)
│   └── entitlements.mac.inherit.plist  # macOS child-process entitlements
├── scripts/
│   ├── rebuild-native.mjs        # Rebuilds native modules for Electron ABI (postinstall)
│   ├── wait-for-dev.mjs          # Waits for Vite dev server before launching Electron
│   ├── check-log-injection.mjs   # Pre-commit: log call sites use sanitizeLogMessage (CodeQL)
│   ├── check-db-migrations.mjs   # Pre-commit: migration / schema consistency
│   ├── check-ipc-contract.mjs    # Pre-commit: preload and main API alignment
│   ├── check-log-panel-filter.mjs
│   ├── check-console-log.mjs
│   ├── check-silent-catches.mjs
│   ├── check-xss-patterns.mjs
│   └── letsmesh-mqtt-probe.mjs   # Optional LetsMesh / MQTT debugging
├── pnpm-patches/                 # pnpm native patches (e.g. electron-builder)
├── docs/
│   ├── accessibility-checklist.md
│   ├── credits.md               # Authors, contributors, community, and libraries
│   ├── development-environment.md  # Development guide and environment setup
│   ├── diagnostics.md           # Full diagnostics reference
│   ├── letsmesh-mqtt-auth.md    # LetsMesh broker auth and analyzer-related notes
│   ├── meshcore-deferred-epics.md   # MeshCore deferred roadmap items
│   ├── meshcore-meshtastic-parity.md  # Meshtastic vs MeshCore feature parity
│   └── images/                  # README screenshots (nodes, map, diagnostics, node-detail, chat, connection, repeaters)
├── release.sh                   # Release automation script
├── electron-builder.yml         # Distributable config (targets, icons, signing)
├── vite.config.ts               # Renderer build (Vite)
├── vitest.config.ts             # Test runner config
├── tsconfig.json                # Base TypeScript config (renderer)
├── tsconfig.main.json           # TypeScript config for main/preload
├── eslint.config.mjs            # Flat ESLint 9; type-aware TypeScript + React (details in CONTRIBUTING.md)
├── postcss.config.cjs
└── package.json
```

---

## Where to Put New Code

This project uses Electron with three process boundaries. Use the appropriate directory based on what the code does.

### `@/main/` - Electron Main Process

Node.js runtime. Handles:

- SQLite database operations (`database.ts`, `db-compat.ts`)
- BLE communication (`noble-ble-manager.ts`)
- MQTT clients (`mqtt-manager.ts`, `meshcore-mqtt-adapter.ts`)
- System integration (window management, GPS, auto-updater)
- IPC handlers for renderer requests

### `@/preload/` - Context Bridge

Exposes a minimal, namespaced API to the renderer via `contextBridge`:

- Database operations (`db:*` channels)
- MQTT operations (`mqtt:*` channels)
- Logging (`log:*` channels)
- Device communication (BLE, serial, TCP)
- Session state

Never expose `ipcRenderer` directly. Use namespaced channels.

### `@/renderer/` - React UI

React 19 + Vite + Zustand. Contains:

- `components/` - UI panels, modals, reusable components
- `hooks/` - Custom hooks for device/protocol interaction
- `stores/` - Zustand stores for state management
- `lib/` - Utilities, types, diagnostics engines, transport abstraction

### `@/shared/` - Cross-Boundary Code

Shared types, utilities, and API contracts used across all boundaries:

- IPC type definitions (`electron-api.types.ts`)
- Shared utilities (`nodeNameUtils.ts`, `sqlLikeEscape.ts`, `withTimeout.ts`)
- Protocol-neutral helpers

### Testing

Tests live alongside source files:

- `@/renderer/**/*.test.{ts,tsx}` - Renderer tests (jsdom)
- `@/main/**/*.test.ts` - Main process tests (node)
- `@/main/index.contract.test.ts` - IPC contract tests (update when changing CSP, IPC limits, or log filters)

### Protocol-Specific Code

The app supports both Meshtastic and MeshCore protocols. Gate features using `ProtocolCapabilities`:

```typescript
import { useRadioProvider } from '@/lib/radio/providerFactory';

const capabilities = useRadioProvider(protocol);
```

Use `useRadioProvider(protocol)` rather than string comparisons to access protocol-specific features.

### Package Management

Always use `pnpm` for package operations to maintain launch speed benchmarks.

### Security

When passing user-controlled data through IPC or logging, sanitize first:

```typescript
import { sanitizeLogMessage } from '@/main/sanitize-log-message';

appendLine(sanitizeLogMessage(userData));
```

---

## IPC Data Flow

To add a new feature that spans the main process, preload, and renderer, follow this flow:

### Step 1: Define Shared Types

Add type definitions in `@/shared/electron-api.types.ts`:

```typescript
export interface MyFeatureResult {
  success: boolean;
  data?: MyData;
  error?: string;
}
```

### Step 2: Add IPC Handler in Main

Register handler in `@/main/index.ts`:

```typescript
ipcMain.handle('myfeature:doThing', async (_event, param: string) => {
  try {
    const result = await doThing(param);
    return { success: true, data: result };
  } catch (e) {
    return { success: false, error: String(e) };
  }
});
```

### Step 3: Expose via Preload

Add to `@/preload/index.ts`:

```typescript
electronAPI.myFeature = {
  doThing: (param: string) => ipcRenderer.invoke('myfeature:doThing', param),
};
```

### Step 4: Consume in Renderer

Use in a hook or component:

```typescript
const result = await window.electronAPI.myFeature.doThing('param');
```

### Channel Naming

Use namespaced channels: `db:*`, `mqtt:*`, `log:*`, `ble:*`, `serial:*`, `session:*`.

### Contract Tests

When changing IPC contracts (CSP, build config, IPC limits, or log filters), update `@/main/index.contract.test.ts`.

---

## Dual-Protocol Architecture

This app supports both **Meshtastic** and **MeshCore** protocols running simultaneously.

### Protocol Switching

- Both protocols connect independently on startup
- Use the protocol switcher pill in the header to bring a protocol's view into focus
- The inactive protocol stays connected in the background
- Per-protocol unread badges (Meshtastic = green, MeshCore = cyan)

### Feature Gating

UI features are gated via `ProtocolCapabilities`. Each protocol exposes different capabilities:

- Meshtastic: Security tab, TAK Server, Modules, PKI
- MeshCore: Repeaters panel, Contact Groups, different MQTT adapter

Use `useRadioProvider(protocol)` to access protocol-specific capabilities.
