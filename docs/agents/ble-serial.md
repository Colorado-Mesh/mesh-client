# Agent reference: BLE and serial

Deep subsystem reference for AI assistants. Open this when a task touches LoRa BLE/serial transports, sidecar GATT reconnect, dual-radio wake stagger, or multi-protocol BLE coexistence. Hard rules live in [`AGENTS.md`](../../AGENTS.md).

Meshtastic and MeshCore share LoRa BLE reconnect contracts on **all platforms** (linux, darwin, win32). **BLE transport** is reticulum-sidecar **btleplug** GATT (`/api/v1/gatt/*`), proxied by Electron main `gatt-sidecar-proxy.ts` over `gatt:*` IPC. Renderer transport: `transportSidecarGatt.ts` (Meshtastic) / MeshCore framing over the same GATT sessions. Session ids remain `meshtastic` / `meshcore`. Serial: `connection.ts`, `serialPortSignature.ts`. Meshtastic BLE open: `connection.ts` / `TransportManager`. Reticulum BLE RNode / BLE Peer use the same sidecar process through rsReticulum and `/api/v1/ble/*`, with separate BLE centrals.

There is **no** Noble manager, **no** Web Bluetooth LoRa path, **no** Noble yield for Reticulum, and **no** 4-day Noble restart nudge.

## Sidecar GATT (btleplug)

- **Owner:** `reticulum-sidecar` `gatt` module (feature `gatt-ble`) owns the Meshtastic/MeshCore central. rsReticulum owns separate RNode/Peer centrals; on Apple, Peer uses its native CoreBluetooth implementation. Running in one process does not make these one adapter handle or scan owner.
- **BLE-light ensure:** LoRa BLE does **not** require the user to Start Reticulum. `ReticulumSidecarManager.ensureForBle()` starts with `--ble-only`, leaving configured Reticulum interfaces, Nomad hosting, and rncp listeners stopped. Public Reticulum status is `running: false, processRunning: true`; GATT uses process liveness. Explicit Reticulum **Start** promotes that same process via `POST /api/v1/stack/start`, preserving LoRa sessions. Without an identity, Start opens the setup shell while RNS ready flags remain false. The hung-process watchdog preserves the current mode.
- **Shared process, not shared RNS session:** Meshtastic/MeshCore GATT needs the sidecar **process**, not `rns_ready` / LXMF live. UI **Restart stack** soft-restarts live RNS in-process (`POST /api/v1/stack/restart`) so LoRa GATT sessions stay up. Explicit **Stop** / Quit still SIGTERM the process (drops GATT until the next `ensureForBle`). On process exit, `GattSidecarProxy.invalidateAfterSidecarExit()` clears the cached HTTP port so reconnect does not hammer a dead port.
- **Proxy:** `src/main/gatt-sidecar-proxy.ts` — scan / connect / disconnect / to-radio / WS fromRadio + RSSI events; replaces former `noble-ble-manager.ts`.
- **IPC:** `gatt:start-scan`, `gatt:stop-scan`, `gatt:connect`, `gatt:disconnect`, `gatt:is-connected`, `gatt:to-radio`, plus push channels for discovered / connected / disconnected / fromRadio / linkRssi / issue.
- **Error taxonomy:** stable snake_case codes (`adapter_missing`, `scan_busy`, `mac_conflict`, `connect_timeout`, `pairing_required`, …) — see `reticulum-sidecar/src/gatt/error.rs`; UI keys under `connectionPanel.errors.ble.*` via `humanizeBleError` / `bleConnectErrors`.
- **HTTP routes:** documented in [reticulum-sidecar-ipc.md](../reticulum-sidecar-ipc.md) (`/api/v1/gatt/availability`, `/scan`, `/sessions`, write/rssi/connected, session WS, registry register/unregister).

## LoRa BLE reconnect parity (Meshtastic + MeshCore)

- **`rfReconnectController`** (`lib/rfReconnectController.ts`): single-owner link-lost / schedule / endAttempt for both runtimes (MeshCore TCP uses the same owner; conn side effects must not call `handleConnectionLost` for TCP).
- **Per-session connect lock** in `connection.ts` (`withGattConnectLock`) plus `connectGattWithScanBusyRetry` when `scan_busy` — do not tear down an unrelated protocol’s GATT session for a scan.
- **Deferred disconnect** while connect/reconnect open is in flight; **flush in reconnect `finally`** in `useMeshtasticRuntime` and `useMeshcoreRuntime` so edge-of-range drops keep retrying.
- **BLE exhaust latch** (`bleReconnectExhaustLatch.ts`): after one full BLE attempt budget (`RF_MAX_RECONNECT_ATTEMPTS_BLE`), latches auto-reconnect off until user Connect / power resume / adapter poweredOn clears it — prevents late disconnect cleanup from restarting 1/N forever when the peripheral is gone.
- **Reconnect attempt budget** (`timeConstants.ts` / `bleReconnectHelper.ts` `raceWithDeadline`): hard ceiling per BLE reconnect open+handshake attempt on **all platforms**.
- **Meshtastic BLE configure stall watchdog:** `MESHTASTIC_BLE_CONFIGURE_TIMEOUT_MS` (120s) in `meshtasticRuntimeWireEffects.ts`; timer resets on NodeDB replay progress via `touchMeshtasticConfigureProgress()` from `nodeStore`.
- MeshCore must **not** start the runtime reconnect loop on disconnect before the first successful configure — ConnectionPanel `reconnectBleWithScan` owns initial retries (`meshcoreEverConfiguredRef`). **Manual disconnect** (`connectionStore.disconnectIntent`) must **not** auto-reconnect — covered by `useMeshcoreRuntime.reconnect.test.ts`, `useMeshtasticRuntime.reconnect-hardening.test.ts`, and `useReticulumRuntime.reconnect-hardening.test.ts`.

**Meshtastic USB serial vendor patches:** `@jsr/meshtastic__core` and `@jsr/meshtastic__transport-web-serial` are patched via pnpm `patchedDependencies` so Web Serial streams abort cleanly on disconnect. Re-hash patches after JSR bumps; see `docs/troubleshooting.md`.

**GATT writes:** Send each complete Meshtastic ToRadio protobuf or MeshCore command as one characteristic value. The sidecar rejects values above 512 bytes before writing, prefers `WithResponse` when the characteristic advertises `WRITE`, and otherwise uses `WithoutResponse` when supported. The OS handles ATT long writes; btleplug 0.11.8 does not expose negotiated MTU. Splitting an application frame into independent 20-byte writes corrupts both protocols. MeshCore BLE echo filtering: `meshcoreCompanionTxEchoFilter.ts`.

**Meshtastic transport writes:** `meshtasticTransportLossDetection.ts` wraps `transport.toDevice` with `createSerializedWritableStream` on **serial, BLE, HTTP, and TCP**. Meshtastic **WiFi/TCP (fast)** uses `TransportTcpIpc` with main-process `meshtastic:tcp-*` IPC (port **4403**). After configure, `getMetadata` retries once after `MESHTASTIC_GET_METADATA_AFTER_CONFIGURE_RETRY_MS` when NodeDB traffic starves BLE. **`meshtasticSdkRoutingErrorConsoleHook.ts`** intercepts SDK routing failures and marks outbound chat rows failed.

## Dual-radio BLE (Meshtastic + MeshCore)

Concurrent GATT sessions to **different** MACs are supported in the sidecar. Startup / wake still **stagger** auto-connect so two protocols do not slam the adapter at once:

| Rule           | Detail                                                                                                                                   |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Init timing    | Dual-radio coordinator (`meshcoreDualNobleBleInit.ts` — name is historical) from **`App.tsx` `useLayoutEffect`**.                        |
| Primary order  | `mesh-client:protocol` localStorage (`meshcore` / `meshtastic`; Reticulum or missing → Meshtastic).                                      |
| Secondary wait | Secondary waits for primary GATT + handshake settle (or first attempt failure) — not full configure.                                     |
| Wake           | `usePowerRecovery`: Meshtastic ~4s, MeshCore ~8s, optional settle wait up to ~30s when both use BLE.                                     |
| Scans          | Main coordinator serializes app-requested scans and LoRa connection setup (`scan_busy`); existing links to other devices stay connected. |
| Tests          | `meshcoreDualNobleBleInit.test.ts`, ConnectionPanel auto-connect coverage.                                                               |

Do **not** reintroduce Meshtastic-only startup gates or child-before-parent init — ConnectionPanel owns auto-connect for both protocols.

## Multi-protocol BLE coexistence (incl. Reticulum)

- Main-process `ble-coexistence-coordinator.ts` tracks pending/live LoRa connections and configured Reticulum BLE addresses (owners `gatt:meshtastic` / `gatt:meshcore` / `reticulum`). Reserve before connection setup so another protocol cannot claim the same address while GATT opens. The sidecar GATT registry separately guards its own sessions; its external-registration API is not an automatic rsReticulum lifecycle bridge.
- Reticulum BLE RNode/Peer and LoRa GATT run in the **same process** with **separate centrals**. The main coordinator serializes app-requested scans and LoRa connection setup without disconnecting links to other devices. Autonomous rsReticulum discovery/reconnect is not covered by that lease, and these checks do not establish hardware coexistence on every adapter.
- Stale bonds / pairing timeouts still latch sidecar alerts (`bleBondRemoved`, `blePairingTimedOut`) — Forget/re-pair; Admin Start pairing shows PIN in-panel over USB (never Meshtastic `123456`).
- Meshtastic/MeshCore may see `scan_busy` while an app-requested Reticulum scan holds the lease; `connectGattWithScanBusyRetry` / `startGattScanningWithRetry` wait for release.
