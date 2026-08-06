# Troubleshooting

Setup (clone, prerequisites, Flatpak build steps) is in [development-environment.md](development-environment.md). This page covers runtime failures, connections, and packaged installs.

## Contents

- [Quick reference](#quick-reference)
- [Development and building](#development-and-building)
- [Installation and packaged apps](#installation-and-packaged-apps)
- [Database and local data](#database-and-local-data)
- [Bluetooth (BLE)](#bluetooth-ble)
- [USB serial](#usb-serial)
- [Wi-Fi, HTTP, and TCP](#wi-fi-http-and-tcp)
- [Sleep, wake, and long-running sessions](#sleep-wake-and-long-running-sessions)
- [MQTT](#mqtt)
- [Meshtastic](#meshtastic)
- [MeshCore](#meshcore)
- [Reticulum](#reticulum)
- [Chat, nodes, and notifications](#chat-nodes-and-notifications)
- [Diagnostics and map](#diagnostics-and-map)
- [App, updates, and localization](#app-updates-and-localization)

## Quick reference

Start here for log analysis, bug reports, and general connection debugging.

### Connection or transport issues: use Log **Analyze**

Open the **Log** panel (right rail), enable **debug** if needed, reproduce the problem, then click **Analyze**. The app scans recent buffered log lines for patterns (BLE, serial, TCP, MQTT, handshake timeouts, etc.) and lists **suggested next steps**. This complements export/delete: use it before filing an issue so you have concrete log context. Analysis is **heuristic**; treat recommendations as hints, not guarantees.

### Reporting bugs: **Export for GitHub** (App tab)

Before opening a GitHub issue, use **App → Support / Bug reports → Export for GitHub**. This writes one zip with the debug snapshot JSON and application log file(s) — the same artifacts maintainers previously asked for in three separate steps. The snapshot includes **Reticulum** sidecar status, interface diagnostics, and config audit when the stack was running at export time (`reticulum` section in `debug-snapshot.json`; `[ReticulumSidecar]` lines in the log).

Open `manifest.json` first when triaging: `appVersion` is package semver; **`buildChannel`** is `test` (Build Binaries), `release` (official Release workflow), or `local` (unmarked local dist). For CI builds, `buildInfo.runUrl` links to the exact GitHub Actions run — do not assume `appVersion` alone means an official release.

**Do not attach Export for Developer or `mesh-client.db` to public GitHub issues.** The developer bundle includes your SQLite database, which may contain **saved passwords** (MeshCore room/repeater credentials, MQTT settings, etc.). It may also include **Reticulum** rnsd config and sidecar stack state under `reticulum/` — share only via a **private channel** when a maintainer requests **Export for Developer**.

Works on macOS, Windows, Linux (.deb / .rpm / AppImage), and Flatpak. Local data paths:

| Install                   | Log / DB location                                            |
| ------------------------- | ------------------------------------------------------------ |
| macOS                     | `~/Library/Application Support/mesh-client/`                 |
| Windows                   | `%APPDATA%\mesh-client\`                                     |
| Linux (native / AppImage) | `~/.config/mesh-client/`                                     |
| Flatpak                   | `~/.var/app/org.coloradomesh.MeshClient/config/mesh-client/` |

**Copy Debug Snapshot** (clipboard JSON) and **Log → Export** remain available under Data Management and the Log panel.

**What to read first in `debug-snapshot.json` (ignore misleading `offline-*` ids):**

| Field                                    | Healthy connected example | Meaning                           |
| ---------------------------------------- | ------------------------- | --------------------------------- |
| `sessionSummary.<protocol>.liveSession`  | `true`                    | RF/MQTT session is live           |
| `sessionSummary.<protocol>.sessionState` | `"live"`                  | Not DB-hydrated-only              |
| `activeTab.liveSession`                  | `true`                    | Active protocol tab is connected  |
| `warnings`                               | `[]`                      | No stuck-chat signatures detected |

The top-level **`legend`** explains that ids like `offline-meshcore` are **internal hydration-slot store keys**, not “disconnected.” When connect reuses that slot (`hydrationSlotIsLiveSession: true`), the id still contains `offline-` while BLE/MQTT are up — that is **expected**.

**Per-protocol bucket fields** (under `meshtastic` / `meshcore`; Reticulum uses `reticulum.bucket` with the same shape):

- `hydrationSlotId` — pre-connect DB hydration bucket (`offline-meshtastic` / `offline-meshcore` / `offline-reticulum`).
- `connectIdentityId` — connected radio/MQTT identity.
- `uiStoreIdentityId` — bucket Chat and Nodes read from.
- `identitySplit: true` while transport is connected — **suspicious** (live ingress and UI may disagree).
- `ui.chatPanelFrozen` + `frozenMessageCount` lagging `liveResolvedMessageCount` — **legacy snapshots only** (current builds always emit `chatPanelFrozen: false`; the freeze path was removed). Ignore unless analyzing an older export.
- `ui.waitingMessagesSilentDrainActive` / `ui.waitingMessagesDrainDeferred` — MeshCore incremental drain in progress or paused behind admin/trace (serial may show small batches). UI: **header status indicator** (queued backlog visible on any protocol tab; **active sync spinner and paused/deferred** state only on the MeshCore tab), not Chat/Rooms panel strips.
- `meshcoreContactPathDiagnostics` — redacted MeshCore contact rows with `pubKeyPrefixHex` (12 hex chars), `hopsAway`, and best known `bestPathBytes` / `bestPathHopCount` from SQLite path history (useful for ping/no-route reports).

**Meshtastic-only extension** (under `meshtastic` bucket):

- `channelPills` — UI channel index + name (runtime channel pills).
- `channelConfigsSummary` — index, name, role, `uplinkEnabled`, `isDefaultPublicPsk` (no PSK material).
- `mqttChannelKeyEntryCount` — count of synced MQTT channel keys from radio config; `null` when empty.

**Automatic warning codes** in `warnings[]`: `identitySplit`, `staleResolvedBucket`, `chatPanelFrozen` (legacy snapshots only; not emitted as a live freeze in current builds), `connectedNoPrimaryMessages`, `windowHiddenOnChat`, `sidecarNotRunning` (Reticulum stack expected but sidecar process down).

**Reticulum-only fields** (under `reticulum`):

- `sidecar` — process `running`, `port`, `lastError`, auto-beacon / interface issue alerts from main.
- `stack` — live `/api/v1/diagnostics`, `/api/v1/config/audit`, identity hashes, stack settings (when sidecar was up at export).
- `diagnosticRows` — Reticulum-native Diagnostics tab rows (`reticulum/*` conditions).
- `fetchErrors` — per-API errors when the stack was stopped or proxy failed.

Developer bundle only: `reticulum/config` (rnsd INI) and `reticulum/mesh_client_stack.json` (mnemonic redacted).

Attach the GitHub report zip (or paste `debug-snapshot.json` from it; redact `myNodeNum` if you prefer). Do **not** attach the developer bundle or `mesh-client.db` to this public issue.

## Development and building

Clone, compile, and local packaging issues. Setup prerequisites live in [development-environment.md](development-environment.md).

### `pnpm install` fails on native module compilation

See [development-environment.md](development-environment.md) for OS-specific prerequisite installation.

### Windows: "Could not find any Visual Studio installation to use"

See [development-environment.md](development-environment.md#windows) for required build tools and the full recovery steps.

### Windows: "Could not find any Python installation to use" (e.g. when building `@serialport/bindings-cpp`)

See [development-environment.md](development-environment.md#windows) for Python setup and npm/node-gyp troubleshooting.

### Linux development: SIGILL during `pnpm install`

**Symptom**: `electron exited with signal SIGILL` during install/rebuild (common in sandboxes or VMs without instructions the prebuilt Electron binary expects).

**Fix**:

```bash
MESHTASTIC_SKIP_ELECTRON_REBUILD=1 pnpm install
pnpm run rebuild
```

Run `pnpm run rebuild` on a host where the bundled Electron binary executes correctly.

### Linux development: SIGSEGV on startup

**Symptom**: `electron exited with signal SIGSEGV` when running from source (GPU process; see [electron#41980](https://github.com/electron/electron/issues/41980)).

**Fix**:

```bash
pnpm run build && pnpm dlx electron . --disable-gpu
```

Or:

```bash
pnpm run electron:open -- --disable-gpu
```

Optional persistent mitigation:

- `export MESH_CLIENT_DISABLE_GPU=1`
- `ELECTRON_OZONE_PLATFORM_HINT=x11 pnpm run electron:open`

### "A native module failed to load" dialog on startup

**Cause**: `@stoprocent/noble` (or `@serialport/bindings-cpp`) was compiled for a different Electron ABI; common after an Electron or Node version change.

**Fix**: Run `pnpm install` (the postinstall script rebuilds native modules for the correct ABI automatically).

- If you still see dlopen errors after switching machines or OSes, delete `node_modules` and run a clean `pnpm install`.
- **Windows**: Also ensure the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) is installed.

### `pnpm run dist:mac` fails with `GH_TOKEN` / "Cannot cleanup"

electron-builder publishes to GitHub when it thinks it's in CI. Local builds use `--publish never` so artifacts land in `release/` without a token. Tag releases use `pnpm run dist:mac:publish` (and `:linux:publish` / `:win:publish`) with `GH_TOKEN` set; see `.github/workflows/release.yaml`.

### `[DEP0190]` when running electron-builder

Node deprecates `spawn(..., { shell: true })` with an args array. This project carries the packaging workaround via pnpm `patchedDependencies` on transitive packages used by the Electron build path. Re-run `pnpm install` if you upgrade `electron-builder` or its transitive packaging deps and the warning returns.

### `duplicate dependency references` during dist

npm's JSON tree lists hoisted packages with many duplicate refs (one per edge). That's expected and not something you need to fix. The patched packaging dependency path keeps that summary at **debug** only so normal `dist:*` runs stay quiet. To see it: `DEBUG=electron-builder pnpm dlx electron-builder --mac` (or your usual dist command).

### `dist:win` fails with "space in the path" or `EPERM` on native modules

**Symptoms**

- `Attempting to build a module with a space in the path` during `pnpm run dist:win` (or `pnpm run rebuild`).
- `EPERM: operation not permitted` when the rebuild tries to replace a locked `.node` file.

**Cause**

1. **Spaces in the project path**: node-gyp is unreliable when the repo lives under a path with spaces (e.g. `C:\Users\Joey Stanford\mesh-client`). This can surface as "Attempting to build a module with a space in the path", "Could not find any Visual Studio installation to use", or EPERM. See [node-gyp#65](https://github.com/nodejs/node-gyp/issues/65#issuecomment-368820565).
2. **EPERM on unlink**: Something on Windows still has the `.node` file open (another `node`/`electron` process, antivirus/Windows Defender scanning the file, or a stuck handle).

**Fix**

1. **Use a path without spaces** (strongly recommended): clone or copy the repo to e.g. `C:\dev\mesh-client`, then `pnpm install` and `pnpm run dist:win` from there.
2. **Clear the lock before rebuild**: quit any running Mesh-Client/Electron dev instances, then delete the affected `build` folder under `node_modules` and retry.
3. **Rebuild then dist**: `pnpm run rebuild`; if that succeeds, run `pnpm run dist:win`.

CI builds avoid both issues by using short paths and clean agents; local Windows builds need the same constraints.

### Windows: `0x80010135` / "Path too long" (e.g. `bluetooth_hci_socket.lastbuildstate`)

**Symptoms**

- Explorer or the compiler shows **error 0x80010135** with **Path too long**, often on a **`*.lastbuildstate`** file under `node_modules`.
- **`bluetooth_hci_socket`** in the name points at **`@stoprocent/bluetooth-hci-socket`** (a native dependency of **`@stoprocent/noble`**). MSBuild writes build state under very deep paths; together with a long clone directory, the full path can exceed the legacy **~260 character** Win32 limit.

**Fix** (use one or more)

1. **Shorten the repo path** (most reliable): clone or copy the project to a shallow path such as `C:\dev\mesh-client` instead of e.g. `C:\Users\…\Documents\GitHub\org\mesh-client`.
2. **Enable long paths in Git** (helps clones/checkouts): `git config --global core.longpaths true`, then re-clone or ensure no stuck long paths in the worktree.
3. **Enable Win32 long paths in Windows** (Windows 10 1607+): this option is **not** available as a normal toggle in **Settings**; enable it via **Local Group Policy** → _Computer Configuration → Administrative Templates → System → Filesystem → Enable Win32 long paths_, or set the registry DWORD **`LongPathsEnabled = 1`** under `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem` (admin rights; reboot may be required). See [Microsoft: Maximum Path Length Limitation](https://learn.microsoft.com/en-us/windows/win32/fileio/maximum-file-path-limitation).
4. **`pnpm run dist:win`** already runs a **hoisted** `pnpm install` to shorten `node_modules` depth before packaging; if **`pnpm install`** / **`pnpm run rebuild`** fails earlier with this error, try the short path and long-path OS settings first, or temporarily: `pnpm install --config.node-linker=hoisted` from a short root path.

### Linux packaged app: `Cannot find module 'readable-stream'`

**Symptom**: On Linux, the installed or AppImage build shows a main-process error when loading MQTT (`bl` → `mqtt-packet` → `mqtt` require stack).

**Cause**: With a hoisted `nodeLinker`, electron-builder can omit some transitive packages from `app.asar` unless a full copy exists at a predictable path (historically worsened when `pnpm list --json` marked nodes as deduped). `mqtt` is loaded from `node_modules` at runtime (not bundled into the main esbuild output).

**Fix in this repo**: `readable-stream@^4.7.0` is a **direct** production dependency (with the existing `patches/readable-stream@4.7.0.patch` for Windows `process/` resolution). Do not remove it when bumping `mqtt` or pnpm. After `pnpm run dist:linux`, verify the asar contains `node_modules/readable-stream`, `node_modules/bl`, and `node_modules/mqtt`. See [electron-builder#9603](https://github.com/electron-userland/electron-builder/issues/9603) and [pnpm#10601](https://github.com/pnpm/pnpm/issues/10601).

### `[DEP0169]` / `url.parse()` deprecation warning

The app uses npm package overrides to force `follow-redirects` and `cacheable-request` onto versions that use the WHATWG URL API, which removes this warning. To trace the source of any deprecation, run:

```bash
pnpm run trace-deprecation
```

### Permission messages in the console

The session allowlist grants **serial**, **geolocation**, and **media** (camera for QR ingest; microphone for Reticulum LXST voice calls). Other permissions such as `web-app-installation` remain denied and may appear as `[permissions] … → denied` in the log.

If microphone permission is denied when placing or answering an LXST voice call:

- **macOS:** System Settings → Privacy & Security → Microphone — allow Mesh-client (or Electron when running `pnpm run dev`). Packaged builds include `NSMicrophoneUsageDescription`.
- **Windows:** Settings → Privacy & security → Microphone — allow desktop apps / Mesh-client. The app opens this page when OS status is `denied`.
- **Linux:** Ensure PulseAudio or PipeWire can capture; Flatpak builds already include `--socket=pulseaudio`. AppImage/deb use the host audio stack.

### Reticulum LXMF paper create/ingest fails

**Symptoms**: Chat **Share as paper** errors; Scan paper / Network QR / OS `lxm://` toast fails; paper badge missing after restart.

| Sidecar / UI error                                 | Likely cause                                               | Fix                                                                               |
| -------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `identity_unknown` / `shareAsPaperIdentityUnknown` | Peer pubkey not in `known_identities`                      | Import peer `lxma://` contact QR or wait for an announce, then retry              |
| `decrypt_failed` / `paperDecryptFailed`            | Paper encrypted to a different identity                    | Switch to the recipient identity slot (Network) that matches the paper            |
| `paper_too_large` / `shareAsPaperTooLarge`         | Message exceeds LXMF paper size cap                        | Shorten the text and recreate                                                     |
| `invalid_uri` / `paperInvalidUri`                  | Truncated or non-paper `lxm://` blob                       | Rescan / recopy the full QR or URI                                                |
| `identity_not_configured`                          | No local LXMF identity                                     | Generate/import identity on Network, ensure stack is running                      |
| Paper badge gone after restart                     | Older builds stripped `received_via: paper` on SQLite save | Update to a build that allowlists `paper` in `reticulumMessageTransport` / DB IPC |

See [reticulum.md](reticulum.md#chat-lxmf) and [sidecar IPC](reticulum-sidecar-ipc.md) paper routes.

### Reticulum Games challenge fails or board does not update

- **Stack not running / games disabled:** Games need a live `rns-stack` sidecar with sibling `lrgp-rs`. Check Connection → Start stack and `GET` status via Games tab (or logs for `games requires live rns-stack`).
- **`unsupported_app`:** Peer lacks that LRGP app (mesh-client and Ratspeak ship Tic-Tac-Toe + Chess). Challenge with `ttt` or `chess`.
- **`not_your_turn` / `invalid_move`:** Local validation rejected the move before send; wait for opponent or pick a legal cell/UCI move.
- **Challenge never arrives:** Path/Direct delivery required for reliable LRGP; ensure a path to the peer (Peers → Probe) or preferred PN fallback. Confirm peer Games tab / unread session list (sidebar Games badge + DM-style ping on inbound challenge).
- **Accept does nothing / session stays Pending:** After a stack restart the Games tab can still list SQLite sessions; the sidecar now rehydrates those into memory on spawn. If Accept still fails, check the action error toast (`unknown_session` / `no_propagation_node`) and that the stack is running.
- **IPC blocked on proxy:** Renderer must use `electronAPI.reticulum.games.*` (`reticulum:games*`); generic `proxyGet`/`proxyPost` to `/api/v1/games/*` is rejected by design.
- **Interop with Ratspeak:** Same LRGP v1 wire (`lrgp.v1` + `0xFB`/`0xFD`). See [reticulum-games-parity.md](reticulum-games-parity.md).

### Reticulum LXST voice call fails or is silent

- **Stack not running:** Call needs a live Reticulum sidecar (`available` + `enabled` + `running` from `/api/v1/voice/status`). Start the stack from Connection.
- **Peer identity unknown:** Dial uses a 32-hex **identity** hash (not only the LXMF destination). Wait for an announce or Probe the peer from Peers / Chat DM, then try Call again.
- **Busy / rejected / no answer:** Line-busy and reject play distinct tones; discovery/ring timeouts surface as no-answer toasts. Only one local call at a time — Hang up before dialing again.
- **Call progress tones (outbound):** Expect **dial tone → peer-derived DTMF burst → UK double-ring** while connecting. **Busy / no-answer** uses a short busy cadence; **connect-fail / unexpected drop** uses a fast reorder tone (not the same as busy). Hearing dial/ring without two-way audio is often still connecting — wait for Established before assuming failure.
- **One-way or silent audio:** Confirm microphone permission (above). **Answer** only warms `AudioContext` on the click; **microphone capture/TX begins after `voice.update: established`** (Call click warms contexts before dial). If capture still fails after Established, check OS privacy and that another app is not exclusive-locking the mic. TX drops increment `localTxDrops` under IPC pressure — hang up and retry on a quieter link.
- **Inbound accept fails (Columba / Python LXST):** mesh-client→peer may work while peer→mesh-client fails on Answer. Current builds defer mic/TX until Established and soft-drop pre-establish PCM (older packages could fatal-error lxst with `active call is not established` on Answer). Rebuild sidecar + app, then retry. If it still fails, check developer-bundle logs for `[ReticulumSidecar]` `call start role=incoming`, `call failed` / `call terminated`, and renderer `[reticulumVoice] voice.error message=…` / `answer failed`. Generic UI toast **Voice call failed** hides the raw rsLXST reason — the log line is definitive.
- **Interop:** Peer must run LXST telephony (Sideband, Ratspeak, Columba, or mesh-client with rsLXST). This is not an LXMF voice-note clip.

If QR camera scanning fails with camera permission denied:

- **macOS:** System Settings → Privacy & Security → Camera — allow Mesh-client (packaged builds include `NSCameraUsageDescription`). `media:ensureCameraAccess` opens the privacy pane when denied.
- **Windows:** Settings → Privacy & security → Camera — allow desktop apps / Mesh-client.
- **Linux:** Chromium/portal behavior; no separate Electron privacy deep link.
- Streams are stopped after a successful decode, Stop camera, and component unmount (no orphaned tracks).

## Installation and packaged apps

Installers, Flatpak, Gatekeeper, and first-launch failures.

### Windows: installed files present but `Mesh-client.exe` is missing (Windows 11 ARM)

**Symptoms**

- After running the NSIS installer, `%LOCALAPPDATA%\Programs\Mesh-client\` contains `resources\`, `locales\`, DLLs, and a Start Menu shortcut, but **`Mesh-client.exe` is absent**.
- The app does not appear under **Settings → Apps → Installed apps**, so there is no uninstall entry (registry `DisplayIcon` points at the missing exe).
- Windows Security **Protection history** shows no quarantine.

**Cause**

On **native Windows 11 ARM**, older arm64 NSIS installers used `Nsis7z` on `app-arm64.7z` archives compressed with ARM64 LZMA. That path can partially extract support files while dropping the main executable. CI builds the exe correctly (it is inside the installer payload); the failure happens at **install time**, not during packaging. Current releases use zip-compressed NSIS payloads (`useZip`) to avoid this extractor path.

Older releases also shipped a **universal** NSIS installer (x64 + arm64 in one `.exe`), which made arch selection worse — use the split **`-arm64.exe`** installer on WoA hardware.

**Fix**

1. Delete the broken install folder: `%LOCALAPPDATA%\Programs\Mesh-client\`
2. Download the **arm64** installer from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases): `Mesh-client Setup {version}-arm64.exe` (not the x64-only `Mesh-client Setup {version}.exe`).
3. Re-run the installer. Confirm `Mesh-client.exe` exists in the install folder and the app appears in **Installed apps**.

**Diagnostic checklist (if the exe is still missing)**

Capture this before opening a GitHub issue — it helps isolate NSIS extract vs copy vs policy blocks:

1. **NSIS install log** — run the installer from Command Prompt or PowerShell with logging:
   ```bat
   "Mesh-client Setup {version}-arm64.exe" /LOG=%USERPROFILE%\Desktop\mesh-install.log
   ```
   After failure, open `mesh-install.log` and search for `Mesh-client.exe`, `CopyFiles`, or `error`.
2. **Event Viewer** — **Windows Logs → Application** during the install window; note any errors from `MsiInstaller`, `Application Error`, or antivirus agents.
3. **Controlled folder access** — **Windows Security → Virus & threat protection → Ransomware protection**; if enabled, try temporarily allowing the installer or install to a short path such as `C:\mc-test` (see step 5).
4. **Install path** — confirm `%LOCALAPPDATA%` is on a local NTFS volume, not OneDrive-redirected or sync-rooted.
5. **Custom install directory** — test a short path:
   ```bat
   "Mesh-client Setup {version}-arm64.exe" /D=C:\mc-test /LOG=%USERPROFILE%\Desktop\mesh-install.log
   ```
6. **Clean tree** — ensure no leftover `Mesh-client` folder or running `Mesh-client.exe` from a prior partial install before re-running the installer.

**Workaround before a fixed release**

Download a CI or release artifact's `win-arm64-unpacked` folder and run `Mesh-client.exe` directly (portable, no installer).

### macOS: File is damaged and cannot be opened

**Official releases (v5.22.0+):** macOS artifacts from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases) are **Developer ID signed and notarized** (`notarize: true` in [`electron-builder.yml`](../electron-builder.yml); signing secrets in [`release.yaml`](../.github/workflows/release.yaml)). They should open from **Applications** without `xattr`. If macOS still blocks a signed build, check **System Settings → Privacy & Security** for an **Allow** entry first.

**Unsigned builds** (local `pnpm run dist:mac` without `CSC_*` / `APPLE_*` env vars, fork CI artifacts, or older pre-notarization releases): macOS tags downloads with **`com.apple.quarantine`**. Gatekeeper may show **"File is damaged and cannot be opened"** (or **"Mesh-client" is damaged and can't be opened**) instead of the usual unidentified-developer prompt — common on **Apple silicon**, not a corrupt file.

**Fix (unsigned / quarantined downloads):**

1. Open **System Settings → Privacy & Security** and scroll to the bottom. If you see "Mesh-client was blocked from use", click **Allow** to run the app.
2. If you don't see the Mesh-client entry in Privacy & Security, or the app still won't open after clicking Allow, strip the quarantine attribute; adjust the path if the app is still under **Downloads** or another folder:

```bash
xattr -r -d com.apple.quarantine /Applications/Mesh-client.app
```

After running `xattr`, check Privacy & Security again (scroll to the bottom); the entry should now appear with an **Allow** button.

**Right-click → Open** on first launch can also help in some cases. Background and discussion: [jeffvli/feishin#104 (comment)](https://github.com/jeffvli/feishin/issues/104#issuecomment-1553914730).

### App crashes on launch (macOS distributable)

- **macOS 26 (Tahoe) + EXC_BREAKPOINT at launch**: ad-hoc or partial signing can crash during ElectronMain/V8 init before any app code runs. Official notarized releases use hardened runtime + Developer ID signing; retest on macOS 26 with a current release build. Local unsigned builds may still need **Right-click → Open** or clearing quarantine ([macOS: File is damaged…](#macos-file-is-damaged-and-cannot-be-opened) above). See [electron#49522](https://github.com/electron/electron/issues/49522) and [electron-builder#9396](https://github.com/electron-userland/electron-builder/issues/9396).
- This may also be a native module signing issue; try rebuilding: `pnpm run dist:mac`
- If building from source: make sure `pnpm install` completed without errors

### Flatpak: `vmwgfx: driver missing` (VMware on macOS)

**Symptom**: `flatpak run org.coloradomesh.MeshClient` fails or exits after Mesa logs `vmwgfx: driver missing` (use `flatpak -v run ...` to see it). Common on **Linux guests in VMware Fusion or Workstation with a macOS host**, including **aarch64** Ubuntu/ARM VMs.

**Cause**: The Flatpak uses the same GPU stack as the x86_64 bundle (`--device=all`, Wayland/X11). It expects a working virtual GPU in the guest. On macOS-hosted VMware, **3D acceleration / `vmwgfx` is often off or unsupported** unless you enable it in the VM settings — without that, Mesa cannot open the VMware DRI driver and Electron’s GPU process fails.

**Fix** (preferred — hardware acceleration):

1. Shut down the Linux VM.
2. In **VMware Fusion** or **Workstation** (on the Mac host): turn on **Accelerate 3D graphics** / **3D acceleration** for this VM (exact label varies by VMware version).
3. Boot the guest and confirm the driver is present, for example:
   ```bash
   grep DRIVER=vmwgfx /sys/class/drm/card*/device/uevent
   ```
4. Reinstall or rerun the Flatpak:
   ```bash
   flatpak run org.coloradomesh.MeshClient
   ```

**Workaround** (software rendering when the host cannot expose `vmwgfx`):

```bash
MESH_CLIENT_DISABLE_GPU=1 flatpak run org.coloradomesh.MeshClient
```

When `/sys/class/drm` is visible inside the sandbox, the wrapper may auto-detect `vmwgfx` and set `MESH_CLIENT_DISABLE_GPU=1` if DRI is unreliable there. Opt out of auto-detection: `MESH_CLIENT_DISABLE_GPU=0 flatpak run ...`. Force GPU despite detection: `MESH_CLIENT_ENABLE_GPU=1 flatpak run ...`.

**Reinstall a release bundle** after downloading a new `.flatpak` from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases):

```bash
flatpak uninstall --user org.coloradomesh.MeshClient
flatpak install --user ./org.coloradomesh.MeshClient-aarch64.flatpak # or -x86_64
flatpak run org.coloradomesh.MeshClient
```

### Flatpak: immediate exit on Arch / CachyOS / Wayland (#598)

**Symptom**: `flatpak run org.coloradomesh.MeshClient` prints `Command failed` right after `Running 'bwrap … -- mesh-client'` with no window. Common on **Arch, CachyOS, KDE Plasma 6, and Hyprland** (pure Wayland). The AppImage from the same release often works.

**Cause**: The Flatpak sandbox mounts an empty `/tmp/.X11-unix`, so Electron cannot fall back to X11 unless the wrapper passes Wayland/Ozone flags. Older bundles also omitted Chromium sandbox flags and `TMPDIR` setup that zypak expects.

The log line `F: /lib32 does not exist in runtime` is **harmless** on x86_64-only runtimes — not the failure cause.

**Fix**:

1. Reinstall the latest `.flatpak` from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases) (bundles after the #598 fix include an updated wrapper).
2. Run with debug logging if it still fails:
   ```bash
   ZYPAK_DEBUG=1 flatpak run org.coloradomesh.MeshClient
   ```
3. Inspect the installed payload:
   ```bash
   flatpak run --command=sh org.coloradomesh.MeshClient
   # inside sandbox:
   ls -l /app/lib/mesh-client/electron/electron
   ls -l /app/lib/mesh-client/resources/reticulum-sidecar/mesh-client-reticulum
   /app/bin/mesh-client --help 2>&1 | head
   ```

**Workarounds**:

```bash
MESH_CLIENT_DISABLE_GPU=1 flatpak run org.coloradomesh.MeshClient
```

**Reinstall**:

```bash
flatpak uninstall --user org.coloradomesh.MeshClient
flatpak install --user ./org.coloradomesh.MeshClient-x86_64.flatpak
flatpak run org.coloradomesh.MeshClient
```

## Database and local data

### Database schema newer than this app (downgrade blocked)

**Symptom**: On launch, a **Startup Error** dialog says the database was upgraded by a newer Mesh-Client, or **Import blocked** when merging a `.db` file.

**Cause**: The local SQLite database `user_version` is higher than this build supports — usually after installing a **newer** release, then opening an **older** build against the same profile.

**Fix**:

1. Install the **latest** Mesh-Client release from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases) (do not downgrade the app after your database has been migrated).
2. If you must use an older build, restore a `.db` backup exported **before** the upgrade, or start with a fresh profile (export first if you need data from the newer schema).

**Log**: Details are in `mesh-client.log` under the app `userData` folder (macOS `~/Library/Application Support/mesh-client/`, Windows `%APPDATA%\mesh-client\`, Linux `~/.config/mesh-client/`).

### Database directory is not writable

**Error**: `"Database directory is not writable: <path>"`

**Cause**: File permissions on the app's `userData` directory are too restrictive.

**Fix**:

- **Mac/Linux**: `chmod 755 ~/Library/Application\ Support/mesh-client` (or `~/.config/mesh-client` on Linux)
- **Windows**: Right-click `%APPDATA%\mesh-client` → Properties → Security → grant your user Full Control

## Bluetooth (BLE)

### BLE connection fails with "Connection attempt failed"

- Make sure your device has Bluetooth enabled and is in pairing mode
- On macOS: check **System Settings > Privacy & Security > Bluetooth**
- Try disconnecting fully first, then reconnecting
- If the device picker never appears, restart the app

### BLE known issues

- **Bluetooth adapter not found**: ensure Bluetooth is enabled at the OS level. On Linux: `systemctl status bluetooth` and `rfkill list`. On macOS: check **System Settings > Bluetooth**. On Windows: **Settings → Bluetooth & devices**.
- **Device not discovered**: make sure the device is in advertising/pairing mode and within range. Try stopping and restarting the scan.
- If BLE is unreliable, prefer Serial (USB) or TCP/HTTP for a stable connection.

#### BLE debug: `mtu=null` and `MTU updated: …` in logs

- After **Noble** `connectAsync`, **`mtu=null`** is common until the stack finishes ATT MTU negotiation.
- A line like **`MTU updated: 20`** comes from the Noble `mtu` event. ATT_MTU must be **≥ 23** per spec; the client **coerces reported values below 23 to 23** for write sizing (treating odd values such as **20** as a Noble/binding quirk, not a literal 20-octet ATT MTU). A **one-time debug** line may note the raw value when that happens (not a warning).
- **Slow NodeDB / large config sync over BLE** can still be limited by **`@meshtastic/core`** queue timing (hundreds of ms between queued packets), not only GATT MTU. Use **Log → Analyze** for hints, or try **USB serial** / **TCP** if throughput matters.

**Windows-specific:**

- Before connecting to a MeshCore device over BLE, pair it first in **Settings → Bluetooth & devices → Add device**. Without pairing, the connection appears to succeed but no data is exchanged.

**Linux-specific:**

- The app uses Web Bluetooth (Chromium's built-in BLE API). You still need a working Bluetooth stack (`systemctl status bluetooth`).
- Linux BLE uses the in-app Bluetooth picker (triggered from a button click); if no picker appears, restart the app and try Connect again.
- **Immediate "User cancelled the requestDevice() chooser"** on Connect (AppImage / `.deb` / `.rpm`) without dismissing a picker:
  1. Chromium multi-fires `select-bluetooth-device`; the app must retain the first callback (#749).
  2. A fire-and-forget cancel-before-connect can also race behind the new chooser and kill it (seen on CachyOS / Arch with 5.25.0). Builds that **await** `cancelBluetoothSelection` before `requestDevice()` fix that race.
     Upgrade to a release that includes both fixes, then retry Connect. If the picker still never opens, check `systemctl status bluetooth` and `rfkill list`.
- **Flatpak:** Connect that fails with little or no UI often means the sandbox lacked `--allow=bluetooth` (needed with `--system-talk-name=org.bluez`). Reinstall a Flatpak from a release that includes that finish-arg. If pairing then fails with **bluetoothctl not found**, use the official AppImage/`.deb`/`.rpm`, or pair the radio on the host with `bluetoothctl` and retry.
- If the Bluetooth adapter isn't detected, check: `systemctl status bluetooth` and `rfkill list`.
- **MeshCore:** After you pick a radio, the app checks `bluetoothctl info <MAC>`. If the device is **not** paired at the OS level, you are prompted for the **PIN shown on the device** and pairing runs via **`bluetooth-pair`** before Web Bluetooth finishes connecting. Meshtastic does not use this gate in the same way (it may use PIN `123456` on the first pairing prompt from Chromium).
- If device pairing fails with "Connection attempt failed", try the **"Remove & Re-pair Device"** button in the app, or manually remove via `bluetoothctl`:
  ```bash
  bluetoothctl
  # Inside bluetoothctl:
  remove XX:XX:XX:XX:XX:XX # Replace with your device MAC
  # Then re-pair from the app
  ```
- For **Meshtastic** devices, the first Chromium pairing attempt may use PIN `123456`. For **MeshCore**, always use the PIN shown on the radio (and the pre-connect prompt when BlueZ reports not paired).
- If devices won't pair or connect, power-cycle Bluetooth:
  ```bash
  bluetoothctl power off
  bluetoothctl power on
  ```
- MeshCore devices must be in Bluetooth Companion mode. If you still see bonds without a PIN, remove the device in `bluetoothctl` or use **Remove & Re-pair Device**, then connect again.

### BLE auto-reconnect: "No previously connected BLE device found"

**Cause**: The reconnect card appeared, but the browser lost the cached device handle; for example, the app was fully quit and relaunched.

**Fix**: Click **Forget this device** on the reconnect card and pair fresh using the Bluetooth picker.

### Dual-radio Noble BLE startup serialization (macOS/Windows)

When both Meshtastic and MeshCore have **different** saved BLE peripherals, startup auto-connect is serialized so two Noble connects do not race:

- Coordinator: `meshcoreDualNobleBleInit.ts`; wired from **`App.tsx` `useLayoutEffect`** (not `useEffect` — child ConnectionPanel auto-connect effects must see primary/secondary roles first).
- **Primary** is chosen from `mesh-client:protocol` localStorage (`meshcore` / `meshtastic`; Reticulum or missing → Meshtastic).
- **Secondary** waits on `awaitNobleBlePrimaryAutoConnectSettled()` (GATT + handshake ready or first attempt settled) — not full device configure.
- All Noble IPC connects go through `withNobleBleConnectMutex()`.

See also wake recovery under [Sleep, wake, and long-running sessions](#sleep-wake-and-long-running-sessions) (Meshtastic-first stagger). For Reticulum BLE RNode vs Noble, see [Reticulum BLE RNode blocks Meshtastic/MeshCore Noble BLE](#reticulum-ble-rnode-blocks-meshtasticmeshcore-noble-ble).

## USB serial

### Serial port not detected

See [development-environment.md](development-environment.md) for OS-specific serial setup and driver guidance.

### Linux: serial port access denied

**Symptom**: `Serial: serial_io_handler.cc:147 Failed to open serial port: FILE_ERROR_ACCESS_DENIED`

**Fix**:

1. Ensure your user is in the `dialout` group (see [development-environment.md — Linux serial permissions](development-environment.md#serial-permissions)).
2. Log out and back in after changing groups.
3. Verify with `groups`.
4. If the group is missing:
   ```bash
   sudo groupadd dialout
   sudo usermod -a -G dialout $USER
   newgrp dialout
   ```

### Meshtastic USB serial: reconnect fails with "port is already open"

After **Disconnect** then **Connect** (or auto-reconnect), the connection panel may show:

`Failed to execute 'open' on 'SerialPort': The port is already open.`

This means Chromium still holds the previous Web Serial session (locked streams). mesh-client ships patched `@meshtastic/core` and `@meshtastic/transport-web-serial` to tear down pipes on disconnect; if you still see this on an older build:

1. **Quit mesh-client completely** (not only Disconnect) and reopen the app, then connect again.
2. Or **unplug and replug** the USB cable, then connect.
3. Open the **Log** panel, enable **debug**, reproduce once, and click **Analyze** — look for **USB Serial Reconnect** recommendations.

BLE or Wi‑Fi/HTTP avoids this USB serial path when you need a reliable reconnect loop.

### MeshCore / Meshtastic USB serial: app frozen or stuck on "Reconnecting…"

If the UI stops updating but the radio is still powered, Chromium may be holding a **zombie Web Serial session** (streams stalled with no error). mesh-client now:

1. Times out serial `open` / reconnect after **15 seconds** instead of hanging forever.
2. Treats **3 minutes** without inbound traffic as a dead link (serial watchdog) and starts auto-reconnect.
3. After **5 failed** auto-reconnect attempts, revokes the stale port permission (`SerialPort.forget()` when supported), clears saved port identity, and shows **Select serial port** in the connection banner (opens the normal port picker).

If auto-recovery does not help:

1. **Quit mesh-client completely** (not only Disconnect), unplug/replug USB if needed, reopen, and use **Select serial port**.
2. Open **Log → Analyze** after enabling **debug** — look for **USB Serial Reconnect** patterns.

This applies on **Windows, macOS, and Linux** (same Web Serial stack). Linux **permission denied** before the first connect is a separate issue — see [Linux: serial port access denied](#linux-serial-port-access-denied).

### Serial port auto-rediscovery after reconnect exhaustion

**Symptoms**: After the port permission is revoked (step 3 above) the device reconnects on its own without a manual **Select serial port**, or it does not and you are prompted after ~1 minute.

**Cause**: `serialPortAutoRediscovery.ts` captures the port signature before escalate clears saved identity, then polls granted Web Serial ports every **5 s** for up to a **60 s** window, matching by signature (or Chromium `portId`). A match reconnects automatically; the window expiring calls `onTimeout` (forget port + picker).

**What to do**: Leave the device plugged in for the ~1 minute window. If it still doesn't rediscover, use **Select serial port** to re-grant the port.

## Wi-Fi, HTTP, and TCP

### HTTP / WiFi connection issues

**`meshtastic.local` (or any `.local` hostname) not found on Windows:**

Windows does not have built-in mDNS resolution. `.local` hostnames require **Bonjour** (installed with iTunes or Apple Devices). Install either:

- [iTunes](https://www.apple.com/itunes/): includes Bonjour automatically
- [Bonjour Print Services for Windows](https://support.apple.com/en-us/search?query=Bonjour%20Print%20Services%20for%20Windows): standalone Bonjour installer

Alternatively, enter the device's **IP address** directly instead of its `.local` hostname.

> A yellow warning is shown below the address input on Windows as a reminder.

**IPv6 address format:**

IPv6 addresses work for Meshtastic Wi‑Fi, MeshCore TCP, and Reticulum RNode Wi‑Fi. Use bracket form when a port is included: `[fe80::1]:4403` or `[fd00::1]:7633`. Bare IPv6 (e.g. `::1` or `fd00::1`) is accepted; the app normalizes bracket form for HTTP URLs automatically.

### Meshtastic: WiFi/TCP (fast) vs WiFi/HTTP

**WiFi/TCP (fast)** on the Connection tab uses Meshtastic's native binary streaming protocol on port **4403** (same `0x94 0xc3` framing as USB serial). Use it when the node exposes TCP and you need fast NodeDB sync — configure typically completes in about a second on large networks instead of 40–60+ seconds over HTTP REST (one packet per request).

**WiFi/HTTP** remains the fallback when TCP is unavailable on the firmware.

**Symptoms suggesting TCP:** HTTP connect succeeds but status stays on **Connecting** or **Configuring** for a long time with a large NodeDB (~250 nodes).

**Address examples:** `192.168.1.10:4403`, `meshtastic.local:4403`, `[fd00::1]:4403`.

### Meshtastic HTTP fails immediately with "Invalid host format"

**Cause:** Builds before v5.21.x validated the hostname incorrectly when the address included a port (`192.168.1.10:443`), rejecting every HTTP connect.

**Fix:** Upgrade to v5.21.2 or later. As a workaround on older builds, omit the port when the app default applies.

Local/private targets include RFC1918 IPv4 (`10.x`, `172.16–31.x`, `192.168.x`), RFC4193 ULA (`fd00::/8`), link-local IPv6 (`fe80::/10`), loopback, and `.local` mDNS names.

## Sleep, wake, and long-running sessions

### macOS sleep / wake and auto-reconnect

After the lid closes or the Mac sleeps, mesh-client pauses reconnect backoff and MQTT I/O until the OS resumes. Recovery is **Meshtastic-first**: expect roughly **4 seconds** after wake before Meshtastic RF auto-reconnect runs, then MeshCore about **8 seconds** later. When both protocols use Noble BLE, MeshCore's auto-reconnect additionally waits (up to **30 seconds**) for the Meshtastic BLE link's GATT connection + protocol handshake to settle — not for full device configure — before it starts its own connect.

- **Noble BLE:** The client tries an immediate connect (main-process peripheral cache) before scanning up to **30 seconds** for a new advertisement.
- **Stuck “reconnecting” banner:** During sleep the UI may show disconnected with connection loss until wake recovery runs. If reconnect never progresses after wake, use **Disconnect & Quit** from the Connection tab or quit the app and reconnect manually.
- **Dual-protocol BLE (Meshtastic + MeshCore):** Auto-reconnect is already staggered Meshtastic-first (see above); manually forcing MeshCore to reconnect before Meshtastic is not necessary and does not match the recovery order. If both protocols are still down after ~30 seconds, use **Connect** on each tab in the same Meshtastic-then-MeshCore order. Concurrent Noble scans from both tabs can block recovery.
- **BLE stack stuck after wake** (`unknown peripheral`, `connectAsync timed out`, `peripheral not found` in the app log): **Quit mesh-client fully** (Cmd+Q), toggle **Bluetooth off → on** in System Settings (or power-cycle the radios), reopen the app, wait ~5 seconds, then use **Connect** on the Connection tab.
- **MQTT-only:** Transient errors such as `ENETDOWN` or `ENETUNREACH` after wake should recover automatically.
- **Renderer hung after wake:** If the log shows `[main] System resumed` followed by `[main] renderer unresponsive after system resume (no heartbeat within 30s)` and **no** `[usePowerRecovery]` lines, the renderer event loop was already dead before wake recovery ran. **Quit mesh-client fully** and relaunch — do not rely on Disconnect alone.

### Windows sleep / wake and auto-reconnect

After sleep or hibernate, mesh-client uses the same resume path as macOS: reconnect backoff and MQTT I/O pause until the OS resumes. Recovery is **Meshtastic-first**: expect roughly **4 seconds** after wake before Meshtastic RF auto-reconnect runs, then MeshCore about **8 seconds** later. When both protocols use Noble BLE over Noble IPC, MeshCore's auto-reconnect additionally waits (up to **30 seconds**) for the Meshtastic BLE link's GATT connection + protocol handshake to settle — not for full device configure — before it starts its own connect.

- **Noble BLE:** Same immediate-connect-then-scan behavior as macOS (peripheral cache, then up to **30 seconds** scanning for a new advertisement).
- **Stuck “reconnecting” banner:** During sleep the UI may show disconnected with connection loss until wake recovery runs. If reconnect never progresses after wake, use **Disconnect & Quit** from the Connection tab or exit the app fully and reconnect manually.
- **Dual-protocol BLE (Meshtastic + MeshCore):** Auto-reconnect is already staggered Meshtastic-first (see above); manually forcing MeshCore to reconnect before Meshtastic is not necessary and does not match the recovery order. If both protocols are still down after ~30 seconds, use **Connect** on each tab in the same Meshtastic-then-MeshCore order. Concurrent Noble scans from both tabs can block recovery.
- **MeshCore pairing after wake:** If BLE appears connected but the MeshCore handshake or GATT notify never completes, confirm the radio is **paired in Settings → Bluetooth & devices** before using **Connect** in mesh-client (MeshCore requires OS-level pairing on Windows).
- **BLE stuck after wake** (`connectAsync timed out`, `peripheral not found`, or GATT notify watchdog messages in the app log): **Exit mesh-client fully**, toggle **Bluetooth off → on** in **Settings → Bluetooth & devices** (or disable/enable the adapter in **Device Manager**), wait a few seconds, reopen the app, then use **Connect**. If disconnects persist, update the Bluetooth driver in Device Manager.
- **MQTT-only:** Transient errors such as `ENETDOWN` or `ENETUNREACH` after wake should recover automatically.
- **Renderer hung after wake:** Same as macOS — if you see `[main] renderer unresponsive after system resume (no heartbeat within 30s)` without `[usePowerRecovery]` logs, quit fully and relaunch.

**Linux Web Bluetooth:** Manual reconnect from the connection banner still requires a user gesture (Connect / picker). Linux does not use Noble IPC; see **Linux-specific** under [BLE known issues](#ble-known-issues) above for pairing and adapter reset steps.

**Reticulum (all platforms):** On suspend, `onPowerSuspend` clears in-memory rnsh sessions and rncp transfers. On resume, `onPowerResume` restarts the sidecar via `connect()` unless the user disconnected.

### Long-running sessions (multi-day uptime)

If mesh-client stays open for **days** on a busy mesh (especially **MeshCore BLE-only** with hundreds of repeaters):

- **Restart the app every 1–2 days** to limit main-process uptime (reduces risk of native BLE / V8 edge cases after ~72h).
- After **4 days**, mesh-client shows a one-time toast suggesting a restart.
- **MeshCore:** default contact cap is **10,000** (App settings); enable **auto-prune by age** if you want SQLite trimmed below that. Avoid bulk repeater status/neighbors refresh when not needed — thousands of `syncNextMessage timed out` lines in the log usually mean the companion radio is overloaded.
- **Meshtastic:** default node cap is **10,000**; enable **auto-prune** in App settings as needed.
- **Reticulum:** restart the sidecar/stack periodically on always-on nodes; message retention prunes run at startup and every 6 hours while the app is open.
- If the app crashes, save **`~/Library/Logs/DiagnosticReports/Mesh-client-*.ips`** (macOS) before relaunching. Main-process crashes often show `EXC_BREAKPOINT` during a timer/GC; include the `.ips` and exported log when reporting.
- **Reporting a crash:** Export the app log (App tab → Export for GitHub), attach the `.ips` if available, and note app version, OS version, uptime (look for `[main] long-session health uptimeSec=…`), and whether MeshCore BLE was connected. Upgrade to the latest release when convenient — crashes on very old builds are harder to reproduce.

After **24 hours** of uptime, the main process logs periodic **long-session health** lines (`[main] long-session health …`) with memory, per-session BLE timer state, and Noble connection age.

### App shows "disconnected" but device is still on

- The Bluetooth connection can drop silently; click Disconnect, then Connect again
- For serial: the USB cable may have been bumped; reconnect

## MQTT

### MQTT: "Connection lost after N reconnect attempts"

**Cause**: Broker unreachable, bad credentials, or wrong port.

**Fix**: Verify the broker URL, port (default 1883, or 8883 for TLS), and username/password. Check that your firewall allows outbound connections on the broker port.

### MQTT: "Subscribe failed"

**Cause**: Topic permission denied on the broker, or wildcards not allowed by the broker ACL.

**Fix**: Confirm the broker's ACL allows your client to subscribe to the configured topic prefix.

### MQTT keeps disconnecting

**Cause**: Wireless interference, broker downtime, token issues (LetsMesh/Colorado Mesh), or normal reconnect backoff after a failed attempt.

**Fix**:

- Check your WiFi/signal strength
- Verify the broker is online
- Expect **exponential reconnect backoff** (60s base, capped at 45 minutes per `src/shared/mqttReconnectSchedule.ts`); connack timeouts retry faster (~250ms)
- For LetsMesh/Colorado Mesh: mesh-client refreshes JWT automatically when MeshCore identity is already cached (including after a successful MeshCore radio session). If you never imported identity and have not connected a MeshCore radio yet, import under **Radio** or use **Custom** credentials; if refresh still fails, try re-importing MeshCore config JSON to replace a corrupt cache
- Enable debug logs to see the disconnect reason

### MQTT connected but no messages from other nodes

**Cause**: LetsMesh and Colorado Mesh are publish-only brokers; you can send packets to the mesh but won't receive other users' traffic over MQTT. The connection is real, but incoming messages are limited.

**Fix**: Expected behavior for public brokers. For two-way MQTT, use a different broker or connect via BLE/Serial.

### "Token expired" on LetsMesh/Colorado Mesh

**Cause**: JWT tokens expire after 1 hour.

**Fix**: The client refreshes tokens proactively before expiry when identity is present. If you still see expiry errors, connect or re-import MeshCore so `public_key` / `private_key` are cached (Radio-tab JSON import, or automatic persistence after a successful MeshCore radio session). As a fallback, paste your `v1_<public key>` MQTT username and a manually generated token under **Custom** if your broker expects a different workflow.

### MQTT "Connection refused" or broker unreachable

**Cause**: Wrong broker URL, port, or firewall blocking the connection.

**Fix**:

- Verify the server URL and port match your broker's settings
- Check that port 1883 (or 8883/443 for TLS/WebSocket) is allowed through your firewall
- For WebSocket brokers (port 443), ensure "Use WebSocket" is enabled in the MQTT settings

### MQTT: private broker — no decrypt or no uplink

**Cause**: Wrong channel PSK, missing AES-256 key, or TLS not enabled when the broker expects `mqtts`/`wss` on a non-standard port.

**Fix**:

- In the Connection tab **Channel PSKs** field, enter base64 keys (16 bytes for AES-128, 32 bytes for AES-256), one per line; use `ChannelName=base64` for MQTT-only channel names. LongFast default is always tried; connect your radio so Radio-tab keys sync automatically.
- Enable **Enable TLS (mqtts / wss)** when the broker requires TLS but you are not on port 8883/443. Use **Allow insecure TLS** only for self-signed or private CA certificates.

### Can't see RF packets on custom MQTT broker

**Cause**: The packet logger publishes to `{prefix}/{pubKey}/packets`, but you're viewing the packets somewhere that doesn't receive published MQTT messages.

**Fix**:

- The app publishes to `meshcore/{IATA}/{pubKey}/packets` (e.g., `meshcore/DEN/AABBCCDDEEFF001122/packets`)
- Use an external MQTT client (like MQTT Explorer, mosquitto_sub, or your broker's dashboard) to subscribe and view the packets
- For Colorado Mesh, subscribe to `meshcore/DEN/+/packets/#`
- For LetsMesh/MeshMapper, subscribe to `meshcore/test/+/packets/#`
- Verify your broker ACL allows publishing to `packets/` topics
- Check the Log panel for "Published RF packet" entries to confirm packets are being sent

## Meshtastic

### Meshtastic Modules tab: “waiting for settings”

If a module section stays on **Waiting for … settings from the device** with Apply disabled:

- The connected firmware may not expose that module key.
- **Remote configure** may still be loading module slices; retry the configure load or check the local radio link.
- **Apply stays disabled** until the device slice hydrates — this prevents overwriting device config with form defaults.

### Meshtastic: Configure node remotely does nothing or is disabled

**Cause**: PKC remote administration (firmware 2.5+) requires a **connected local Meshtastic radio** as the admin path. MQTT-only connections cannot administer remote nodes. The target node must be reachable through your radio, and trust may require a one-time public-key exchange. `ADMIN_PUBLIC_KEY_UNAUTHORIZED` means the client has no trusted public key for that node (NodeDB and saved admin key both missing or wrong).

**Fix**:

- Connect via BLE, Serial, or HTTP/WiFi (not MQTT-only).
- Use **Configure node** on Radio, Modules, or Security, or **Configure node remotely** from node detail after saving the node's admin public key.
- In **node detail**, paste the remote admin public key (base64, `base64:…`, or 64-character hex) and save; the client uses NodeDB keys when present and falls back to this stored key for PKI admin packets.
- For first-time trust, use **Copy** public key on the Security tab and complete setup on the remote node per Meshtastic PKC docs.
- See [README — Security (PKI)](../README.md#key-features) for the full feature list.

### Meshtastic remote admin: "One or more channel settings could not be loaded" / "LongFast load failed"

**Cause**: Multi-hop PKI admin reads for channel 0 can be delayed, reordered, or interleaved with stale `ADMIN_APP` traffic. A fast `ADMIN_APP` shortly after `getChannelRequest` is not always the channel response. Firmware expects `get_channel_request` as a 1-based value on wire (channel 0 is sent as `1`). Channel 0 reads use the long-tail policy (up to 3 attempts, 120s each), while LoRa reads use a shorter essential timeout.

**Fix**:

- Keep a local Meshtastic radio connected (BLE/Serial/HTTP). Remote admin does not run over MQTT-only paths.
- Open **Log** and reproduce the load. Filter for `MeshtasticRemoteAdmin` debug lines to inspect correlation decisions (`resolve`, `ignore-stale`, `ignore-uncorrelated`, `pending-timeout`, `pending-reset`).
- If channel 0 still fails, capture the log and verify whether the pending request was cleared by timeout/reset or by an unexpected routing/admin response.
- Retry from the Radio tab once path quality improves (multi-hop latency and retries can be significant on congested links).

### Meshtastic MQTT: decrypt works on other clients but not mesh-client

**Cause**: Older builds used an incorrect AES-CTR nonce layout for Meshtastic MQTT channel crypto. Private brokers with AES-128 or AES-256 channel PSKs need the Meshtastic packet-id nonce (fixed in recent releases).

**Fix**:

- Update to the latest mesh-client release.
- Confirm **Channel PSKs** on the Connection tab match the channel (16- or 32-byte base64 per line; `ChannelName=base64` for MQTT-only names).
- Enable **Enable TLS (mqtts / wss)** when the broker requires TLS on a non-standard port.

### Meshtastic SDK routing failures mark chat rows failed

When the Meshtastic SDK logs a routing / queue failure, mesh-client intercepts matched `console.error` / `console.warn` lines via `meshtasticSdkRoutingErrorConsoleHook.ts`, logs them at `console.debug`, and applies `applyMeshtasticOutboundRoutingErrorFromLog` (or `FromRejection`) so the outbound Chat row shows **Failed**. Unmatched queue rejections may still appear as `[meshtasticSdkRoutingErrorLog]`.

## MeshCore

### MeshCore contact age prune and favorites

Startup maintenance can delete stale MeshCore contacts by age. Important details:

- **`last_advert` is Unix seconds**, not milliseconds. Invalid retention day counts are ignored (they previously caused mass deletes).
- **Favorited contacts are exempt** from age-based deletion.
- Contacts with **`NULL last_advert`** are never age-pruned (only count-based limits apply).
- If favorite stars stopped working after a store migration, update to a build with identity-scoped favorite toggles (`patchNodeFavorited` on the active connection identity).

### MeshCore: UI slow or frozen with large repeater lists (USB serial)

**Symptoms**: Repeaters tab stutters or the whole window stops responding; USB serial sessions feel stuck after Neighbors / Status / Sensor (LPP) actions.

**Common causes**:

- **Large contact/repeater lists (1,000+)** — list tabs virtualize rows, but USB serial still serializes companion RPCs; prefer **Nodes → search** for one repeater instead of scrolling the full Repeaters table.
- **Queued public messages (Sync now)** — MsgWaiting backlog is drained **incrementally in the background** after connect and when the radio pushes event 131 (including after you send). The **header status indicator** (queued backlog and active sync on any protocol tab; **paused/deferred** state only on the MeshCore tab) shows silent auto-drain or deferred drain behind repeater admin/trace work. The determinate progress state appears when you click **Sync now** and the radio confirms a non-empty queue. Large backlogs may take a minute on manual sync; wait for the indicator to finish before switching tabs during heavy sync.
- **Multi-hop repeater RPCs** (Neighbors, Status, telemetry) share one serialized USB serial queue. Retrying rapidly or querying distant repeaters (8+ hops) can block the link for up to **120 seconds** per request; queued pings up to **180s** each. **Load more** on a neighbor list is another full Neighbors RPC (~120s) — prefer it over re-clicking **Neighbors** (which replaces the first page). Page request size is 50, but firmware reply buffers often return fewer rows.
- **Concurrent Ping + Status** — MeshCore allows only **one traceroute at a time** on the RF link; multiple pings are queued serially. Status/Neighbors/Sensors wait for an in-progress ping to finish before using the companion queue (see [Serialized traceroutes](meshcore-meshtastic-parity.md#serialized-traceroutes-protocol-requirement)).

**Fix**:

1. Stay on **Nodes** or **Chat** for day-to-day use; open **Repeaters** only when you need bulk repeater admin.
2. Avoid repeated **Neighbors** / **Status** clicks on the same repeater while a request is in progress; use **Load more** when the heading total exceeds the listed rows.
3. After **sleep or hibernate**, if MeshCore does not reconnect automatically, use **Disconnect → Connect** on the Connection panel.
4. If the UI freezes completely on USB serial, **quit mesh-client** (not only Disconnect), unplug/replug USB if needed, reopen, and **Select serial port**. See also [USB serial frozen](#meshcore--meshtastic-usb-serial-app-frozen-or-stuck-on-reconnecting).

### MeshCore reply misquote / duplicate chat messages

**Reply misquote cause:** The official MeshCore companion firmware sends unkeyed replies — `@[Display Name] body` — without identifying the parent message. The receiving client makes a best-guess match using the most recent message from that sender, which is wrong when the user replies to an older message. This is a wire protocol limitation, not a bug in any single client.

The client deduplicates overlapping RF and MQTT hears within **5 minutes** (cross-transport and channel RF replay). Room posts and tapbacks use a **60 second** window. A second MQTT-only copy may still appear if both hears arrive via MQTT without RF — that can be expected.

**Reactions on other clients:** By default mesh-client sends tapbacks and text replies as keyless `@[Display Name] …` (official companion wire). Inbound keyed `@[Name#key]` and emoji-only replies render locally as tapback badges via [`meshcorePromoteEmojiOnlyReplyToTapback`](../src/renderer/lib/meshcoreChannelText.ts). Inbound MeshCore Open wire (`r:HASH:INDEX`, `g:GIFID`) is always parsed for display.

**MeshCore Open compatibility (optional):** In **App → MeshCore Open wire (experimental)**, enable **MeshCore Open compatibility** to send keyed text replies (`@[Name#key] body`), compact `r:` reactions (fallback to keyless tapback when the emoji is not in the Open index), and `g:` Giphy GIFs (paste URL/ID or use the **GIF** button in Chat). Default off — use only when other nodes on your mesh run MeshCore Open-aware clients. Details: [meshcore-meshtastic-parity.md — MeshCore emoji reactions](meshcore-meshtastic-parity.md#meshcore-emoji-reactions-tapbacks) and [GIF wire](meshcore-meshtastic-parity.md#meshcore-open-gif-wire-ggifid).

### MeshCore: "Get Telemetry" returns timeout

**Cause**: The remote node has no environment sensors, or the request timed out before the node responded.

**Fix**: Not all nodes support environment telemetry. The error is shown inline in the node detail modal and is safe to ignore.

### MeshCore: "Get Neighbors" button not visible

**Cause**: The button is only shown for **Repeater**-type contacts (contact type 2). Chat and Room contacts do not support the neighbor query command.

**Fix**: Open the node detail modal for a Repeater node (shown as "Repeater" in the hardware model field). If the heading total is larger than the listed rows, use **Load more** (Repeaters panel or node detail) instead of re-querying from scratch.

### MeshCore: Status / Sensors / Neighbors toast when disconnected

**Cause**: Status, Telemetry, and Neighbors throw when there is no active MeshCore connection so the Repeaters panel and node detail can show an error toast (previously Status/Telemetry could fail silently).

**Fix**: Reconnect the radio on the Connection panel, then retry the admin action.

### MeshCore: Cannot connect via Bluetooth, USB, or HTTP

**Bluetooth:**

- The device must be **flashed as Companion Bluetooth** (the default BLE flashing mode).
- The device must be **paired** with your computer before connecting:
  - **Windows**: Pair first in **Settings → Bluetooth & devices → Add device**, then connect from the app.
  - **Linux**: Use **`bluetoothctl pair <MAC>`** first, or let the app handle the pairing prompt. See [BLE known issues](#ble-known-issues) for detailed steps.
- **Try in the official MeshCore app first**: if the device connects there, it will work in Mesh-Client.
- If Bluetooth fails, try serial (USB) or HTTP as alternatives.

**USB (Serial):**

- The device must be **flashed as Companion USB** (not BLE-only firmware).
- If the serial port is not detected, see [Serial port not detected](#serial-port-not-detected).

**HTTP (WiFi):**

- The device must be **flashed as Companion HTTP** (not BLE-only firmware).
- If `meshtastic.local` is not resolved, see [HTTP / WiFi connection issues](#http--wifi-connection-issues).

### MeshCore: Room server login, posts, and Windows 10

**Minimum Windows**: Mesh-Client (Electron 41) supports **Windows 10 version 1809+** and Windows 11. Windows 10 22H2 is supported; issues reported only on Win10 are usually MeshCore protocol or app regressions, not an unsupported OS.

**Rooms vs Chat**: Official MeshCore room clients use the **Rooms** tab BBS login path. Room-server posts appear there (`SignedPlain` / channel `-2`), **not** in Chat channel pills. Admin traffic sent as normal **channel text** shows in **Chat** only.

**Guest / read-only login fails with timeout or "rejected"**:

- When the room server **guest password is empty**, use **Continue read-only** on the Rooms login overlay. That sends **zero password bytes** (same as the official Android app). **Login** with an empty guest field is disabled; it would send the default **`hello`** password instead.
- When the server **does** configure a guest password, enter that value in the guest field and click **Login** (some communities use **`hello`**).
- **Room admin CLI** (Rooms → admin overlay): many stock room servers use **`hello`** as the default admin password when none was configured. The guest field placeholder shows `hello`; admin login uses the same MeshCore default when you type it explicitly — do not confuse that with **Continue read-only**, which sends zero bytes for blank guest servers.
- Logs showing push **`0x86`** (frame 134) mean **LoginFail** (wrong password or ACL denied). **Room login** rejects immediately on a prefix-matched LoginFail. **Repeater admin login** keeps waiting for a possible LoginSuccess (meshcore.js behavior on congested links); timeout after LoginFail alone is reported as timeout, not wrong password.
- **Admin password** working while guest/read-only fails usually means the guest password on the server does not match what the client sent, or ACL denies read-only login.
- If the room **changed its password** and mesh-client keeps trying to log in, open the **Rooms** tab: expand **Saved passwords** in the sidebar (or use the login overlay for the selected room). Use **Stop auto-login** to stop connect-time retries while keeping the old password stored, or **Forget saved password** to clear the stored guest/admin password and turn off auto-login and auto-sync. After a wrong-password failure, auto-login is turned off automatically until you log in again with **Remember password** or re-enable it.

**MeshCore repeater saved passwords**:

- Per-repeater admin passwords are stored in SQLite as `meshcoreRepeaterCredential:<nodeId>` when you check **Remember** on the repeater auth dialog. Open **Repeaters** → expand **Saved repeater passwords** (sidebar label) to **Forget** a stale entry, or use **Change password** / **Save password** on the node detail modal for a single repeater.
- If **Remember** fails silently, the password still works for the current session (ephemeral secret) but will not survive restart — check the app log for `appSettings:set` errors and retry after updating mesh-client.

**Room post fails with "unsupported on this firmware"**:

- The **companion radio** only accepts **`TXT_TYPE_PLAIN` (0)** for outbound `CMD_SEND_TXT_MSG`. mesh-client sends plain UTF-8 post text after a successful room login. **`TXT_TYPE_SIGNED_PLAIN` (2)** is for **inbound** room-server pushes (author prefix in the wire body); using it for outbound posts returns `ERR_CODE_UNSUPPORTED_CMD` (1). Log out and log in again, then post from the **Rooms** tab while connected over BLE/serial/TCP.

**Garbled prefix (e.g. `ÑÇÕ0`) on inbound room posts**:

- Inbound **SignedPlain** pushes include the **first four bytes of the author public key** before the message body. mesh-client strips that prefix in the **Rooms** UI. If another client shows those characters, it is displaying the raw wire body from the room server.

**Room unread badges**:

- New room BBS posts increment the **Rooms** sidebar badge and per-room counts on the room list. They do **not** increment the **Chat** tab badge (by design). Stay logged in to receive firmware-pushed posts after login.
- The Rooms badge only counts posts for room servers still in your contact list. Clearing **Chat** channels does not clear Room messages — use App → Danger Zone → clear **Room messages** (or all MeshCore messages) if a badge remains after rooms are gone.

**No room history after login**:

- Firmware only **pushes new posts** after a successful login; it does not backfill old BBS messages. Enable **Auto-sync** on the Rooms tab to periodic re-login while connected.
- mesh-client stores posts received while you are logged in on **this device**. Quitting the app or staying logged out for days means posts from that period will not appear later unless they were persisted locally. See the **Rooms** tab history note under Auto-sync.

**pyMC / server console shows posts but Rooms tab does not (cross-client)**:

- The room **server log** (e.g. pyMC) lists everything the BBS stored. mesh-client and the official app only show posts **pushed to your radio while you are logged in** to that room (see above). Posts made before your login, or while you were logged out, will not appear until someone posts again after you re-login (or use **Auto-sync** to periodic re-login).
- For a fair test: keep **both** clients logged into the **same room** while connected, then post from one side and confirm the other receives it within ~30 seconds on RF.
- mesh-client sends outbound room posts as **`TXT_TYPE_PLAIN`**; inbound BBS pushes use **`TXT_TYPE_SIGNED_PLAIN`** (author prefix stripped in the Rooms UI).

**Room bot stats or system lines in Chat as a DM like `!ac200e59`**:

- That tab label is the room server node id (`!` + 8-digit hex), not a person. Room-server **PLAIN** lines (e.g. `Bot Stats (24h):`) belong in the **Rooms** tab, not **Chat → DMs**. Current builds route `hw_model === 'Room'` traffic to Rooms; reload or refresh messages after upgrading if old rows were stored as DMs.

**Read-only → write upgrade does nothing**:

- After **Continue read-only**, use **Upgrade access** (or **Login** with the guest password) so the client sends a fresh **SendLogin** with `forceRelogin`. Enter the real guest password (often **`hello`**); empty field Login is disabled on the main overlay to avoid sending `hello` when the server expects blank read-only login.

**Long room posts show as `[1/2]`, `[2/2]`…**:

- MeshCore room wire limit is ~160 bytes per post. mesh-client splits longer text into multiple posts with `[i/N]` prefixes. The **Rooms** tab merges consecutive chunks from the same sender for display; other clients may show separate lines.

**Queue badge stuck at `Q: 255/256`**:

- Usually means the companion radio outbound queue is nearly full. Enable debug logging and export logs if the badge stays red for minutes with no traffic; look for `[useMeshcoreRuntime] high queue depth=`.
- Some **HTTP/TCP** companions pad the legacy 7-byte STATS CORE frame to 9 bytes with `raw[7]=0` and `raw[8]=0xff` (padding sentinel). mesh-client treats that signature as 7-byte layout (`queue_len` at byte 6). If chat send/receive works but the badge is red with `rawHex` ending in `0000ff`, upgrade to a build that includes this fix ([#600](https://github.com/Colorado-Mesh/mesh-client/issues/600)).
- On older builds, CORE stats could also be mis-parsed (false `Q: 255/256` with normal traffic).

**Windows packaged updater: `Cannot find module 'semver'`**:

- Fixed by declaring `semver` as a direct production dependency (same class of issue as `builder-util-runtime` on hoisted `dist:win` builds). Updater falls back to GitHub Releases API until you install a build with the fix.

**Retest checklist (after upgrading from a known-good build)**:

1. Connect MeshCore over TCP or BLE; confirm nodes load.
2. Open **Rooms** → with **empty guest password** on the server, click **Continue read-only** (not **Login** with an empty field). With a configured guest password, enter it and click **Login**.
3. Post as admin; confirm the post appears in the **official Android app** on the same room (SignedPlain BBS path).
4. Confirm room posts appear in **Rooms** with unread badges (not Chat channel pills).
5. On **Connection** tab, receive a **channel** message on a channel you are not viewing → sidebar **Chat** badge and red pill on that channel when you open Chat.
6. Export logs (**Log → Export**) if login still fails; include `[meshcoreRoomLoginRpc]` and `[useMeshcoreRuntime] sendRoomPost` lines.

### MeshCore: Trace Route or Ping trace times out

**Cause**: Nodes you only **hear** on the mesh; but that do **not** have **your** node in **their** contact list; are sometimes called foreign or one-way contacts. MeshCore firmware may not answer **Trace Route** (node detail) or **Ping trace** (Repeaters panel) for those peers, so the app waits until the trace/ping timeout with no TraceData response. You may see **Trace route timed out** in the node detail modal or an error toast from **Ping trace**.

**Parallel pings**: MeshCore does **not** allow parallel traceroutes on one radio. mesh-client queues them, but two back-to-back pings can take up to **180s** each (including 0-hop direct-retry). **Status/Neighbors/Telemetry** use **120s** timeouts and wait for the active trace (TraceData) and same-node ping wrapper to finish first. Prefer **one ping at a time** when troubleshooting. See [meshcore-meshtastic-parity.md — Serialized traceroutes](meshcore-meshtastic-parity.md#serialized-traceroutes-protocol-requirement).

**Multi-hop route priming / no route**: When outbound path bytes are missing but the UI shows multi-hop, ping/trace first waits passively for PathUpdated (129) and contact refresh (**15s + 5s × hops**, capped at **45s**). For **2+ hops**, if that still yields no usable hash-segment path, mesh-client may run up to **two** flood-advert priming rounds before `SendTracePath` (listener registered **before** each advert). **1-hop** targets may use a synthesized `[relayPrefix, destPrefix]` path when a direct 0-hop repeater is known. If priming and synthesis still fail, ping may fail fast with **No route from radio yet** instead of waiting the full trace timeout. One-way contacts may still time out with no TraceData after priming.

**Fix**: When possible, exchange contact adds so the remote node lists you as a contact. If you cannot add them (or they never add you), treat the timeout as expected, not a Mesh-Client defect when the radio never returns a result. For multi-hop repeaters, wait for contact/path updates or run **Ping trace** once before CLI (Repeaters panel auto-pings on first multi-hop CLI when no trace exists this session).

## Reticulum

AGPL Rust sidecar (`mesh-client-reticulum`), interfaces, LXMF, RRC, and RNode Wi‑Fi. See also [reticulum.md](reticulum.md) and [Reticulum sidecar IPC](reticulum-sidecar-ipc.md).

### RRC connect stuck / Cancel

**Symptoms**: Hub stays on **Connecting…** / **Awaiting welcome**; Cancel appears in the RRC header.

**Cause**: Path discovery, Link handshake, and WELCOME can take up to the proxy timeout (~60 s). A previous connect may still be aborting.

**What to do**:

1. Click **Cancel** — renderer sets disconnect intent and calls `POST /api/v1/rrc/disconnect` for that hub hash so the in-flight connect is aborted.
2. Confirm the destination hash is 32 hex and the stack has a path (Peers / Topology).
3. Retry connect; check sidecar logs for `rrc` timeouts (`path lookup`, `link proof`, `WELCOME`).

### RRC hub dropped vs Disconnect

**Symptoms**: Hub shows **Reconnecting…** with an error, rooms still listed; or the hub disappears after you clicked Disconnect.

**What to do**:

1. **Unintended drop** (`will_reconnect: true`): sidecar retries with backoff (~2–30 s), preserves desired rooms (including join keys), and rejoins after WELCOME. Wait for **Active** or check `rrc.error` / link-close reasons in the log.
2. **Explicit Disconnect / Cancel** (`local_disconnect` or `will_reconnect: false`): that hub session is removed from the UI. Reconnect manually or rely on hub auto-join when the stack starts.
3. Failed initial connect also clears the hub slot so it cannot exhaust the 8-session cap.

### RRC false self-PART / hubParted banner

**Symptoms**: Busy rooms show repeated “Left the room (hub parted you)” / self leave when other members part; or an involuntary hub PART looks like a kick/ban.

**Cause**: Older logic treated member-fanout `PARTED` as self-leave. Sidecar now classifies actor-facing self PARTED vs other-member fanout (`parted_concerns_self`); involuntary self-PART while the room is still desired queues silent rejoin and the UI uses neutral `rrc.moderation.hubParted` (not kick/ban copy).

**What to do**: Upgrade / restart the sidecar. If the banner appears after a true hub PART, re-join the room (or wait for auto-rejoin when still desired). Kick/ban wording is reserved for moderation notice paths only.

### RRC history shows fewer messages than Retention

**Symptoms**: App → Retention keeps **10,000** RRC messages, but opening a room only shows ~**500**.

**Cause**: Per-room UI hydrate caps at `RRC_ROOM_HISTORY_LOAD_COUNT` (**500**) via `rrcRoomHistory.ts`. SQLite may still hold up to the retention count; older rows are not all loaded into the session store.

**What to do**: This is expected. Retention prune (`db:pruneRrcMessagesByCount` / age) controls disk; the 500 cap is a session/UI hydrate limit, not a wipe.

### Reticulum sidecar won't start or health poll times out

**Symptoms**: Connection tab **Start stack** fails; logs show `[ReticulumSidecar]` health poll timeout; `reticulum:getStatus` reports `lastError`. Identity **Generate** / **Import** errors with `Reticulum sidecar is not running`.

**Checks**:

0. **Identity wizard**: click **Start stack** at the top of the Reticulum Connection panel before generating or importing a mnemonic. The sidecar must be running for `reticulum:proxyGet` / `proxyPost` identity routes.
1. **Dev — binary missing**: build once from repo root: `pnpm run reticulum:sidecar:build` (requires [Rust](https://rustup.rs/); see [development-environment.md](development-environment.md#reticulum-sidecar-optional)). Electron **Start stack** can auto-run `cargo build` on first click, but you need `cargo` on `PATH`. Error text `sidecar binary not found` means `reticulum-sidecar/target/debug/mesh-client-reticulum` does not exist yet.
2. **Dev — run / health**: `pnpm run reticulum:sidecar:dev` or confirm `curl http://127.0.0.1:19437/api/v1/status` after **Start stack**.
3. **Packaged app — sidecar missing from installer**: older Electron releases (before CI bundled the sidecar) ship without `mesh-client-reticulum` under `resources/reticulum-sidecar/`; the UI shows a message about a missing bundled sidecar — **upgrade to a newer release** (or use Flatpak on Linux). WoA needs the **arm64** installer (`Mesh-client Setup {version}-arm64.exe`) with an **arm64** sidecar inside, not the x64 binary.
4. **Packaged app — verify install**: confirm `mesh-client-reticulum` (or `.exe` on Windows) exists under the app resources (`reticulum-sidecar/` beside the executable).
5. **macOS Gatekeeper**: unsigned local sidecar builds may need `xattr -cr` on the binary or ad-hoc signing for dev.
6. **Port conflict**: sidecar picks an ephemeral port; stale processes under `~/Library/Application Support/mesh-client/reticulum/` are rare — quit the app fully and retry.

Keep Rust current with `pnpm run update` (runs `rustup update` and rebuilds the sidecar when `cargo` is available).

### Reticulum sidecar cargo build fails (`register_packet_tap` / `RETICULUM_CARGO_BUILD_FAILED`)

**Symptoms**: **Start stack** fails; logs show `RETICULUM_CARGO_BUILD_FAILED` or Rust errors such as `method not found in ReticulumHandle`, `register_packet_tap`, or `PacketTapEvent`. Electron may surface `RETICULUM_RNS_PATCH_MISSING` after upgrading mesh-client.

**Cause**: Full-stack (`rns-stack`) dev builds call `register_packet_tap` in the sidecar, but that API lives in a local rsReticulum overlay ([`reticulum-sidecar/patches/rsReticulum-packet-tap.patch`](../reticulum-sidecar/patches/rsReticulum-packet-tap.patch)) until [ratspeak/rsReticulum#10](https://github.com/ratspeak/rsReticulum/pull/10) merges. CI applies overlays via `clone-ratspeak-stack.sh`; a sibling `../rsReticulum` checkout without the overlay fails to compile.

**Fix** (canonical recover path):

1. From mesh-client repo root, re-float siblings and re-apply overlays:
   ```bash
   ./scripts/clone-ratspeak-stack.sh
   pnpm run reticulum:sidecar:build
   ```
   `clone-ratspeak-stack.sh` floats `rsReticulum` / `rsLXMF` / `rsNomad` to `origin/main` (override with `RS_*_REF` for bisect) and fails if an overlay will not apply.
2. If siblings already exist and you only need overlays: `./scripts/ensure-rsReticulum-patches.sh` then `pnpm run reticulum:sidecar:build`.
3. **Manual apply** (single overlay):
   ```bash
   git -C ../rsReticulum apply reticulum-sidecar/patches/rsReticulum-packet-tap.patch
   pnpm run reticulum:sidecar:build
   ```
4. On **newer rsReticulum** checkouts that already include the auto-beacon utun fix upstream, only the packet-tap patch is required — `apply-rsReticulum-auto-beacon-utun.sh` is a no-op.

Quit mesh-client fully, reopen, and click **Start stack** again.

### Reticulum AutoInterface log spam on macOS (VPN utun / ENOBUFS)

**Symptoms**: Log panel floods with `[ReticulumSidecar] auto: beacon TX failed` on `utun0`, `utun4`, or similar every ~1.6 s. Error text may include `No buffer space available (os error 55)`. Diagnostics may show an **AutoInterface beacon** info row for VPN tunnel interfaces.

**Cause**: Reticulum **AutoInterface** discovers link-local IPv6 on macOS VPN tunnel interfaces (`utun*`). Those interfaces often cannot transmit IPv6 multicast beacons, so the sidecar retries indefinitely and fills `mesh-client.log`.

**Fix**:

1. **Update mesh-client** to a build that includes the rsReticulum overlay `rsReticulum-auto-beacon-utun.patch` (skips `utun*` during enumeration and backs off repeated TX failures).
2. **Dev rebuild**: from repo root, prefer the canonical recover path, then rebuild:
   ```bash
   ./scripts/clone-ratspeak-stack.sh
   pnpm run reticulum:sidecar:build
   ```
   Or apply individual overlays (`./scripts/apply-rsReticulum-packet-tap.sh`, `./scripts/apply-rsReticulum-auto-beacon-utun.sh`, `./scripts/apply-rsReticulum-link-client-nomad.sh`, …) then `pnpm run reticulum:sidecar:build`.
3. **Workaround on old builds**: disable **AutoInterface** under Connection → Interfaces if LAN discovery is not needed (TCP/RNode paths still work).
4. **Physical NIC failures** (`en0`, `wlan0`, …): restart the stack; check firewall/multicast permissions — that indicates real LAN discovery failure, not VPN noise.
5. **Local DMs hang with Auto + LAN TCP hub** — see [Reticulum local DMs hang with AutoInterface + private TCP hub](#reticulum-local-dms-hang-with-autointerface--private-tcp-hub).

Log path: `~/Library/Application Support/mesh-client/mesh-client.log` (macOS).

### Reticulum local DMs hang with AutoInterface + private TCP hub

**Symptoms**: LXMF Direct to a LAN peer stalls on **Sending** (or takes minutes) while **AutoInterface** is enabled and a **private** TCP/UDP hub is also up (e.g. local transport at `192.168.x.x`). Disabling Auto and restarting the stack makes the same DMs work over the hub (`received_via` / path interface shows TCP). Announce flood is not required to reproduce.

**Cause**: AutoInterface peers are normal Reticulum **0-hop** neighbors. Transport prefers fewest hops; Auto and TCP are both `network` medium. A fresher Auto path can stay **active** even when a private hub path to the same peer is also 0-hop (equal-hop tie / learn order). If that Auto link is unhealthy (multicast, carrier, beacon issues), Direct waits on Auto while the private hub path sits unused as a backup. A 0-hop path **to the hub itself** does not mean Direct already chose the hub for the peer.

**Automatic recovery** (mesh-client sidecar):

1. **Health preempt** — If Auto looks degraded for delivery (beacon/carrier/status) and a live **private** path exists (RFC1918 / IPv6 ULA or link-local / `.local` TCP/UDP), suppress Auto and open Direct on that private path before waiting out a full Auto link hang.
2. **Failure failover** — If Direct still fails or times out on Auto, exhaust backups **private non-Auto → public hubs → preferred PN** (does not preempt healthy Auto to the internet).

Healthy Auto is left preferred (RNS default). Public hubs are never chosen by the health preempt.

**Manual workaround**: Connection → Interfaces → disable **Auto** → restart stack if prompted. Keep the private hub up; confirm it is not `ECONNREFUSED` in the log (`hostLink` TCP probe).

### Reticulum Nomad Network or topology API returns 404

**Symptoms**: Device log shows `sidecar GET /api/v1/nomadnetwork/nodes failed: 404` or `/api/v1/topology` **404** while the sidecar process is running. Nomad Network tab may show **API unavailable**.

**Cause**: The running `mesh-client-reticulum` binary is **older than** the Rust sources in `reticulum-sidecar/` (routes were added after the binary was built). Dev auto-build only ran when the binary was missing, or you have not rebuilt since pulling.

**Fix**:

1. From repo root: `pnpm run reticulum:sidecar:build`
2. Quit mesh-client fully, reopen, **Connection → Start stack**
3. Confirm with `curl` against the sidecar port from logs: `/api/v1/nomadnetwork/nodes` and `/api/v1/topology` return JSON 200

In dev, **Start stack** now rebuilds when `reticulum-sidecar/src/**/*.rs` or `Cargo.toml` is newer than the debug binary.

### Nomad My Pages hosting enabled but not serving

**Symptoms**: After relaunch, **Nomad Network → My Pages** shows no green **Serving to network** chip even though you left serving on; or Start serving fails after choosing a folder. Status may show `last_error` such as `content_source_required` / `content_source_unavailable` / `invalid_content_source`.

**Cause**: Hosting requires a watched folder. The remembered content folder is missing, moved, or invalid (neither `pages/` nor `.mu` files), serving was enabled without a content source, or auto-restore failed after the Reticulum stack came up. Preference `nomad_serving_enabled` may stay true so hosting can retry once the folder is fixed.

**Fix**:

1. Open **My Pages**, click **Choose folder**, and select the site root (directory with `pages/`) or the `pages/` directory.
2. Click **Start serving** if it did not auto-resume (Start stays disabled until a folder is chosen).
3. Check **Log → Analyze** (Reticulum protocol) for **Nomad Page Hosting Issues** (`[nomad-serving]` / `[NomadHosting]`), or **Export for GitHub** — those lines are in `mesh-client.log`.

### Nomad Network pages hang or almost never load

**Symptoms**: Most Nomad pages spin for a long time then fail; a few nearby nodes load quickly. UI shows humanized errors (via `nomadPageErrorHumanize.ts`) instead of raw sidecar codes when recognized.

**Humanized error categories** (sidecar code → user message):

| Sidecar code            | Meaning                                                             |
| ----------------------- | ------------------------------------------------------------------- |
| `path_timeout`          | No route to the node (path lookup timed out)                        |
| `pubkey_not_found`      | Destination identity key not cached yet — wait for a Nomad announce |
| `link_timeout`          | Link could not be established in time (UI may say path OK vs stale) |
| `response_timeout`      | Link opened but page payload did not arrive in time                 |
| `missing_identity_hash` | No remembered identity for the node yet                             |
| `network_not_ready`     | No usable path/interface yet — wait for hub/path or restart stack   |
| `nomad_not_serving`     | Remote node is not serving Nomad pages                              |
| `invalid_url`           | Malformed Nomad page/file URL                                       |
| `transport_unavailable` | Reticulum transport unavailable — restart stack                     |
| `sidecar_not_running`   | Sidecar not running — start stack from Connection                   |
| `response_too_large`    | Remote response exceeded the sidecar size cap                       |
| `nomad_busy`            | Another Nomad page/file query still holds the link lock             |

Unrecognized codes pass through unchanged.

TCP/network Nomad Links use path-scaled initiator hops (`link_hops = clamp(path_hops, 3, 7)`) and a LinkClient proof wait of the **remaining overall MeshChat deadline** (~45s TCP after instant pubkey recall), matching v5.25.0. Do not cap LRPROOF at hops×6 or a 30s floor — that false-failed multi-hop hub pages that still load on release. First attempts use a cached path when present (no DropPath storm); missing paths RequestPath briefly and may return `path_timeout`. On TCP `link_timeout`, the sidecar suppresses the dead iface, drops the failed via, promotes ranked path-slot backups / other live hubs (extra RequestPath when another TCP/RF iface is up), then retries inside the same fetch. LXMF Direct chat uses the same exhaustion before the one-shot preferred-PN fallback. `force_path_ok=true` means rediscovered after absence only (cache hits log `force_path_ok=false`). Failure logs (`[nomadNetworkStore] … fetch failed` and sidecar `Nomad Link query failed`) include `path_hops`, `link_hops`, `proof_budget_secs`, `force_path_ok`, `path_ensure_kind`, `elapsed_ms`, `tried_interfaces`, `failover_rounds`, `iface`, and `raw=`. UI errors distinguish cached-path vs rediscovered-path link failures.

**Cause**: Older `LinkClient` always waited for a fresh path-response announce for the destination public key, even when Nomad announces had already cached it. Successful fetches could also deregister all `nomadnetwork.node` announce handlers. Distant/high-hop nodes can still time out at the path stage (expected RF/mesh reachability limits).

**Fix**:

1. Ensure rsReticulum overlay is applied: `./scripts/apply-rsReticulum-link-client-nomad.sh` (see [patches/README.md](../reticulum-sidecar/patches/README.md); upstream [ratspeak/rsReticulum#14](https://github.com/ratspeak/rsReticulum/pull/14)).
2. Rebuild sidecar: `pnpm run reticulum:sidecar:build`, restart stack.
3. Prefer low-hop nodes while testing; hop count is shown in the Nomad list.
4. Match the humanized message to the table above — `path_timeout` / high hops often mean RF reachability limits, not a mesh-client bug.
5. For TCP `link_timeout`, check log fields `tried_interfaces` / `failover_rounds` / `iface` first (primary signal after path failover), then `path_hops` / `link_hops` / `proof_budget_secs` / `raw=` — UI hop counts can lag the path table; trust `path_hops`. Persistent fails after the full proof budget usually mean the peer/hub did not return LRPROOF.

### Reticulum sidecar stops during dev (Vite HMR)

**Symptoms**: After saving a file in `pnpm run dev`, many `[ReticulumIPC] proxyGet failed: Reticulum sidecar is not running` lines appear; Nomad Network / Network (propagation, identity) panels fail until you restart the stack.

**Cause**: Hot module reload remounted the Reticulum runtime, which previously called `reticulum:stop` on every unmount.

**Fix**: Current dev builds **preserve** the sidecar across HMR remounts. If you still see this on an older build, click **Start stack** again on Connection. Explicit **Disconnect** / app quit still stops the sidecar.

### Reticulum `proxyGet` fetch failed / many `[ReticulumIPC] start` lines

**Symptoms**: Device log or devtools shows `Error occurred in handler for 'reticulum:proxyGet': TypeError: fetch failed`, often in bursts of three or more at once. The app log may also show dozens of `[ReticulumIPC] start` entries within a few seconds while Nomad/Network/Peers panels stay empty or stale.

**Cause**: Overlapping sidecar start attempts restart the process before its HTTP server is ready (start/reconnect storm). Panels keep calling `proxyGet` against a dead or stale localhost port during the churn.

**Fix**: Current builds serialize sidecar start in the main process and suppress autostart/reconnect feedback loops during an in-flight start. If you still see this: disable **Autostart stack** on Connection, click **Start stack** once, wait up to ~30s for the health poll, then reopen other Reticulum tabs.

### Reticulum announce interval resets after saving stack settings

**Symptoms**: You set an announce interval on the Network tab, then saved **Stack settings** (transport / log level) and the interval returned to **0**.

**Cause**: `PUT /api/v1/stack/settings` replaces all four fields (`enable_transport`, `share_instance`, `loglevel`, `announce_interval_sec`). A partial JSON body omits `announce_interval_sec`, which deserializes as **0**. `GET /api/v1/stack/settings` and missing keys in rnsd config default to **3600** s (1 h) after bootstrap migration — a value of **0** in the UI usually means an explicit setting or a partial PUT, not the new GET default.

**Fix**: Current Network UI merge-reads settings before PUT. If you hit this on an older build, re-save the announce interval after stack settings changes.

### Clear announces does not empty the Peers tab under rns-stack

**Symptoms**: **Clear announces** on Network succeeds but peers reappear after refresh.

**Cause**: With the full **`rns-stack`** build, `DELETE /api/v1/announces` clears the stub cache only; the live RNS path table repopulates on the next `GET /api/v1/peers`.

**Workaround**: Expect peers to return while connected to a live network; use the stub sidecar for offline UI testing of an empty peer list.

### Reticulum identity hash mismatch (stub vs live stack)

**Symptoms**: UI shows a configured identity hash that does not match Ratspeak/rsReticulum on disk, or LXMF peers cannot reach you.

**Cause**: The stub stack can mark identity configured in `mesh_client_stack.json` before `config/identity` exists; the live bridge may spawn a fresh RNS identity until the identity file is written.

**Fix**: Generate or import identity with the stack running; restart the stack after identity changes. Compare `GET /api/v1/identity/status` with your Ratspeak identity file.

### Reticulum Map empty or no markers

**Symptoms**: Map tab shows empty state, sidebar list only, or no markers despite peers on the Peers tab.

1. **Stack not running** — start the stack from Connection; Map ingest requires live `rns-stack`.
2. **No discovery announces heard yet** — only interfaces with `discoverable=yes` appear. Wait for transport propagation; stack identity re-announce default is **3600 s (1 h)** when unset (RMAP publish interval remains separate; see Network → RMAP controls).
3. **LoRa without TCP hub** — Diagnostics / config audit may show `rmap_no_tcp_hub`. Enable `rmap.world:4242` or another TCP hub and restart the stack.
4. **Missing GPS in announce** — nodes without latitude/longitude appear in the list panel only (no map marker).
5. **Global coverage** — the in-app map shows **heard** opt-in nodes only; use **Global map** (rmap.world) for worldwide view.
6. **`discover_interfaces`** — sidecar enables `discover_interfaces = Yes` on bootstrap; restart the stack after upgrading if the Map tab stays empty on an old config.
7. **Stub sidecar** — dev builds without `rns-stack` return an empty discovered list.
8. **Filter empty** — interface-type filter pills may exclude all rows; try **All**.
9. **Refresh errors** — transient sidecar errors show inline `refreshFailed` without clearing last-good markers.
10. **No publish-capable interface** — Auto and outbound TCP client types cannot publish RMAP discovery. Eligible types are RNode / RNode Multi / KISS (with serial), BLE peer, I2P, UDP, and pipe.
11. **Partial publishing (amber X of Y)** — Connection shows **publishing X of Y** in amber when some but not all eligible interfaces have `discoverable=yes`. TCP hubs never count toward Y. Use Network → **Publish on RMAP v4** (check again while indeterminate) or per-interface **RMAP** toggles on Connection to sync the rest.

### Reticulum BLE RNode blocks Meshtastic/MeshCore Noble BLE

**Symptoms**: Reticulum stack is running with an enabled BLE RNode; Meshtastic or MeshCore BLE scan/connect fails with “Bluetooth scan in progress (reticulum)” or Noble sessions stay disconnected.

**Cause**: On macOS/Windows, sidecar start **yields Noble BLE** so btleplug can pair the RNode. While the yield holds `scanOwner === 'reticulum'`, Meshtastic/MeshCore Noble connect is rejected. After grace, yield stops re-contending so an offline RNode cannot thrash LoRa BLE. mesh-client releases the scan mutex when the RNode connects, the grace window expires, prepare fails closed after Noble disconnect timeout, or the stack stops. When Reticulum **Auto-start** is on, Meshtastic/MeshCore BLE autostart also waits `awaitReticulumBleCoexistenceClear` (default max ~**65 s**).

**Fix**:

1. Wait up to ~**60s** after stack start for the BLE RNode to connect (Connection tab interface status **up** / **online**) — that matches the OS passkey window (~65 s including the RF autostart buffer).
2. Stop the Reticulum stack if you need immediate Meshtastic/MeshCore BLE access.
3. Ensure you are on a current build with watcher-only yield (`useReticulumNobleBleYieldWatcher` — not interface-snapshot release), `reticulumNobleBleYield.ts`, and `ble-coexistence-coordinator.assertCanConnect`.
4. Check Device logs for `[BleCoexistence]` and `[useReticulumNobleBleYieldWatcher]`.
5. If CoreBluetooth logs **“Event receiver died”**, Noble connect raced mid-pair — wait for coexistence clear or stop the Reticulum stack before retrying LoRa BLE.

### Reticulum BLE RNode pairing fails (wrong PIN / no PIN on display / not in macOS list)

**Symptoms**: BLE RNode stays offline; logs show `peripheral.connect() ok` then `[pair] TX read err` / `BLE pairing in progress` / `BLE pairing timed out`; Connection may show a pairing-timed-out sidecar alert. The RNode does not appear under System Settings → Bluetooth. Admin **Start pairing** does not put a code on the radio display.

**Cause**: RNode generates a **new** 6-digit PIN each pairing — there is **no** default. Users sometimes enter **123456** (Meshtastic’s fixed default). Admin **Start pairing** shows the PIN in the **Admin Bluetooth panel over USB** (radio display often stays blank). Discovery uses the sidecar BLE scan (`ble://…`), not the macOS Settings device list. The OS passkey dialog appears when the stack triggers SMP (TX-char read).

**Fix**:

1. Stop the stack (or disable the BLE RNode) so reconnect does not thrash while you prepare.
2. Forget any half-paired RNode in System Settings → Bluetooth.
3. Get a real PIN: USB → Admin → Bluetooth → **Start pairing** (watch the **Admin panel**, not the radio screen), **or** ~7 s button hold on display boards for an on-screen PIN.
4. Start the stack **once**, enter that PIN in the OS dialog within ~60 seconds — never `123456`.
5. The device may only show as Paired in System Settings **after** a successful bond.
6. For repeated offline BLE interfaces, **remove the interface and add it back** (**Pick device**) to refresh the stored Bluetooth address before retrying pairing.

### Reticulum BLE RNode bond is stale (OS still shows Paired)

**Symptoms**: Connection / Diagnostics show a BLE bond-stale banner for an RNode interface; Connect fails; System Settings still lists the device as Paired.

**Cause**: Sidecar latched `interfaceIssueAlert.bleBondRemoved` (“Peer removed pairing information”). The OS bond no longer matches the radio.

**Fix**:

1. Forget the RNode in System Settings → Bluetooth.
2. Start pairing on the radio (Admin → Bluetooth, or ~7 s button hold).
3. **Remove and re-add** the BLE interface (**Pick device**) so the saved `ble://` id refreshes.
4. Restart the Reticulum stack and enter the new 6-digit PIN when prompted.

### Reticulum attachment image not showing in Chat

**Symptoms**: LXMF `[file:…:image/…]` bubble shows the filename label but no inline image.

**Cause / checks**: File missing from `userData/reticulum/attachments/`, SVG/unsupported MIME, path outside the jail, magic-byte mismatch, IPC rate limit, or read failure (UI falls back to label only).

**Fix**: Confirm the attachment was cached inbound, that the MIME is a supported raster type (not SVG), and retry after scrolling away and back. Check Device logs for `chat:readReticulumAttachmentAsDataUrl`.

### Reticulum remote propagation sync fails or never completes

**Symptoms**: **Sync messages** stays Establishing, fails with “not an LXMF propagation node”, “no link proof”, or marks Complete incorrectly after cancel.

**Cause / behavior**:

- Remote sync needs a known identity (and prefers a path). Missing identity → `PROPAGATION_IDENTITY_UNKNOWN`.
- Destinations that announce as delivery/other (including TCP hubs) → `PROPAGATION_TARGET_NOT_PN`. Add a destination that announces `lxmf.propagation`.
- Establishing with **no LRPROOF** often means the PN lacks a reverse path to your LXMF identity. Sync always sends an LXMF delivery announce and waits briefly before Linking; if that still stalls, use Network → **Announce now** and retry.
- HaveAll / Complete is success (not failure). Cancel or Establishing stall (~45s) must not advance “last synced”.
- Transfer-phase hangs use a renderer hard ceiling (~180s) plus lxmf-core’s own timeouts.
- Auto-sync interval counts from the last _successful_ sync; failed attempts only apply a short cooldown (~2 min) so they do not postpone the next scheduled sync forever.

**Fix**: Prefer a discovered `lxmf.propagation` node, wait for an announce/path, retry **Sync** (or **Announce now** then Sync), and check Device logs for `[propagation-sync]` / offer errors. If Add fails with **offer unsupported**, the destination does not speak LXMF `/offer`. If Sync/Add fails with **peering cost exceeds max**, raise **Network → Advanced PN hosting → Max peering cost**.

### Reticulum local PN hosting not discoverable

**Symptoms**: Local Host propagation node is enabled but peers never hear your PN announce / cannot `/offer` or `/get`.

**Cause**: Hosting requires a live stack with identity signing key; enable starts `lxmf.propagation` LinkManager + announce loop.

**Fix**: Confirm sidecar is running, identity is configured, **Network → Propagation → Host propagation node** is Enabled, and check logs for `[propagation-serve]` / `[propagation-announce]`. Tune announce interval under **Advanced PN hosting**.

### Reticulum PN hosting policy apply fails

**Symptoms**: Saving **Network → Advanced PN hosting** (peering cost, storage limits, static peers, announce interval) fails or reverts; Device log shows hosting-policy errors.

**Cause / checks**:

- Sidecar rejected the policy (`peering_cost_exceeds_max`, `stamp_flex_exceeds_cost`, range limits, or invalid 32-hex static peer). The renderer now validates the same rules before PUT; failure surfaces via the panel error path.
- Stack/identity not ready (hosting apply needs a live sidecar). BLE/USB hubs themselves are unrelated — policy is local lxmf-core config, but the stack must be running to persist it.
- Invalid `node_name` (control characters or longer than 128 characters).

**Fix**: Fix the invalid field (keep peering cost ≤ max; stamp flex ≤ stamp cost; static peers as lowercase 32-hex). Confirm Reticulum stack is **running**, then re-apply. Check logs for `[reticulumPropagationStore] hosting policy` / sidecar `hosting-policy` responses.

### Reticulum last synced time looks wrong after update

**Symptoms**: Propagation UI shows a far-future or absurdly old “last synced” time after a sidecar upgrade or clock skew.

**Cause**: `last_propagation_sync_at` comes from the sidecar as Unix seconds. A future clock (or bad stamp) was previously accepted wholesale; refresh now clamps future values to local `Date.now()`.

**Fix**: Run **Refresh** / reopen Propagation after fixing the system clock. Trigger a successful **Sync** to rewrite a sane stamp.

### MeshCore Colorado Mesh / LetsMesh won't connect after upgrade

**Symptoms**: MeshCore MQTT preset worked before upgrade; broker connection fails on port **1883** or wrong topic.

**Cause**: Colorado Mesh moved to **wss port 443** with topic **`meshcore/DEN`**; LetsMesh uses **`meshcore/test`**. Stale `mesh-client:mqttSettings:meshcore` may retain old port/topic. Malformed topic prefixes (not `meshcore/{IATA}` or `meshcore/test`) also block Connect on device-signing brokers.

**Fix**: Re-select the preset on the Connection tab, or clear `mesh-client:mqttSettings:meshcore` in devtools Application → Local Storage and reconnect. Migrations run on app start via `connectionPanelStorageMigrations.ts` (port/topic repair + IATA shape normalize).

### MeshCore Colorado Mesh one-time region prompt

**Symptoms**: After upgrade, a dialog asks whether you are in Colorado when MQTT is set to Colorado Mesh. MQTT Auto-connect is deferred until you answer.

**Cause**: Colorado Mesh is a **regional** broker. mesh-client prompts existing Colorado-preset (or Colorado host) users once so non-Colorado users can switch to **LetsMesh**. Auto-launch will not connect to Colorado until that choice is stored.

**Fix**: Choose **I am in Colorado** to keep the preset (Auto-connect resumes if enabled), or **Switch to LetsMesh**. The choice is stored in `mesh-client:coloradoMqttRegionAck-v1` and is not shown again. Selecting Colorado Mesh later shows a confirm that the preset is for Colorado-area users and publishes under `meshcore/DEN`.

### Reticulum DM stuck on Sending (MeshChatX / shared instance)

**Symptoms**: Outbound Reticulum DMs stay **Sending**; Device log shows `link delivery timed out` with `link establishment timeout`, and many `failed to queue path request for LXMF delivery` lines. **Diagnostics** may list per-peer **Direct LXMF link … timed out** rows (warning). Connection may show **sidecar interface issues** only for stack health (TX queue drops, transport saturated, TCP hub failures) — not single-peer link timeouts. Sniffer may show a **Link Request** that never completes.

**Cause**: Usually **RNS transport overload**, not a missing mesh-client chat handshake. Common triggers:

1. **Shared instance conflict** — `share_instance = Yes` with another Reticulum app still running (MeshChatX, Ratspeak, standalone `rnsd`) fighting the same IPC socket. mesh-client may attach as `SharedInstanceClient` and **not spawn** local TCP hubs (Connection then shows misleading “TCP hub unreachable”).
2. **Dead TCP hub still enabled** — outbound queue fills; path requests fail with _no available capacity_.
3. **No remote propagation node** — when Direct fails and no preferred **remote** PN is configured, there is no store-and-forward retry (local inbox does not count). With a remote preferred PN, the sidecar retries once via that PN (see **Stale path + Failed via TCP** below).

**Fix**:

1. **Fully quit** other Reticulum apps (MeshChatX, Ratspeak, any `rnsd` tray process) — not just close the window — **or** turn off **Share Reticulum instance** (Connection banner / Network → stack settings) and restart the stack.
2. **Stop and restart** the mesh-client Reticulum stack (Connection → **Restart stack** or stop/start). Stopping (or an unexpected sidecar exit) clears the interface-issue tracker immediately.
3. Disable unreachable TCP interfaces on Connection → Interfaces (only when not in shared-instance client mode). Disabling or removing a hub drops that name from the TCP/TX latch **immediately** (and keeps it from reappearing while logs catch up); each latch also ages out after a **5-minute** per-entry TTL (`RETICULUM_INTERFACE_ISSUE_ALERT_STALE_MS`), not a single global timestamp.
4. Retry the DM; use **Peers → Request path / Probe** if the peer is reachable but the path is stale.
5. Configure a **propagation node** on Network → Propagation for offline delivery.

New/incomplete configs default to `share_instance = No` and `instance_name = mesh-client` so mesh-client does not attach to system `\0rns/default`. **Upgrades are not auto-migrated** when Share is already `Yes` or `instance_name` is already `default` — turn Share off (banner / Network / Diagnostics repair) and restart, or fully quit the other RNS app. Use Network → **Check config** (or `pnpm run reticulum:config:check`) to lint the on-disk INI.

Export for GitHub (`reticulum.sidecar.interfaceIssueAlert`, link-timeout counts) helps confirm transport saturation vs. a single peer outage.

### Reticulum: no propagation node configured

**Symptoms**: Chat shows a persistent amber **propagation** notice; send failures toast _No propagation node configured_; offline peers never receive LXMF.

**Cause**: Direct LXMF links require a live path. When the peer is offline or unreachable, mesh-client needs a **remote propagation node** (lxmd store-and-forward) — not a TCP transport hub.

**Fix**:

1. Open **Network → Propagation** (Chat notice **Set up propagation** jumps there).
2. Add a **32-character LXMF destination hash** from whoever runs the propagation node you trust.
3. Set **Preferred** (manual mode) or leave **Auto** when multiple nodes are listed.
4. **Local propagation hosting** stores messages for peers that sync with you — it does **not** replace a remote propagation node for peers you cannot reach directly. Preferring Local shows a warning toast; Chat still treats local-only as “no remote PN.”

**Stale path + Failed via TCP:** When a path exists, mesh-client tries **Direct** first. If Direct fails and a preferred **remote** PN is configured, the sidecar retries once via that PN (Ratspeak-style store-and-forward). Without a remote preferred PN, the row stays **Failed** even if Ratspeak on the same machine deposits successfully.

**Not the same as transport:** Ratspeak TCP hubs (e.g. `rns.ratspeak.org:4242`) and [rathole](https://github.com/ratspeak/rathole) are **connectivity / transport** tools, not LXMF propagation. mesh-client does not ship a default community propagation hash.

### Reticulum: Ratspeak DMs work but mesh-client stays silent

**Symptoms**: Another Reticulum client (Ratspeak, Sideband, MeshChat, **Columba**, **Retichat**) exchanges DMs with a mobile peer after both sides announce; mesh-client shows outbound stuck **Sending** / **Queued** / **Failed**, **zero inbound**, or a Chat contact that never appears under **Peers**.

**First reply Ack’d, second shows**: After mesh-client sends a **Direct** DM, the peer’s first reply often shows **Ack** on their client but never appears in mesh-client Chat/SQLite; a second reply usually lands. That reply rides the **outbound-initiated reusable Direct link**. The sidecar must wire `LinkDeliveryManager::set_inbound_packet_sender` (live stack start → `spawn_lxmf_outbound_backchannel`) so plaintext reaches the same unpack path as peer-initiated `lxmf.delivery` links — otherwise rsLXMF still sends **LinkProof** (Ack) and drops the payload. Upgrade / rebuild the sidecar and **Restart stack**. Developer bundles: look for `LXMF outbound-link backchannel packet` after the peer’s first reply; inbound ring catch-up cannot recover messages that never entered the ring.

**Cause**: LXMF requires (1) an **`lxmf.delivery` announce** so peers learn a path _to_ this identity and (2) inbound destination registration (`RegisterDestination` + LinkManager) so link payloads reach Chat. Older sidecars stored announce interval in config without scheduling announces; current builds send startup + periodic delivery announces and register `lxmf.delivery`. Short messages from Python clients (Sideband/Columba) often use **opportunistic** DATA — current sidecars wire `set_inbound_raw_channel` (lxmd parity) so those packets are not dropped after proof.

**Checks**:

1. Upgrade / rebuild the sidecar (`pnpm run reticulum:sidecar:build`) and **Restart stack**.
2. On Network, use **Announce now**; on the other client, confirm mesh-client’s **LXMF** hash (Network identity → LXMF destination, not only the identity hash) appears after the announce.
3. Same fabric: enable the same TCP hub / Auto / RNode paths on both clients when A/B testing.
4. Contact named in Chat but missing from Peers → path dead; use **Peers → Request path / Probe**, or wait for the peer’s announce on that fabric.
5. **Auto interface up ≠ Auto peers.** Auto “up” means LAN multicast carrier works; peer rows appear only when another RNS node announces onto that Auto group (or paths are owned by that interface). Multi-hop peers labeled with a TCP hub name and a shared `via` are hub fanout, not LAN neighbors.
6. Configure a remote **propagation node** if the peer is often offline (does not replace missing announces).
7. **Columba / Sideband opportunistic triage** (developer bundle, default `RUST_LOG=warn`): after a send from the phone, look for `[ReticulumSidecar]` lines:
   - `LXMF inbound opportunistic packet` — frame reached the raw channel
   - `opportunistic LXMF decrypt failed` (+ `error=…`) — ciphertext did not decrypt to this identity
   - `inbound data not an LXMF message` with `via=opportunistic` — decrypt OK, unpack failed
   - `inbound LXMF queued for clients` — sidecar accepted the message (if Chat still empty, look at renderer ingest / identity)
   - **None of the above** after a Columba send → packet never hit `lxmf.delivery` (wrong dest hash on the phone, missing reverse path/announce, or not opportunistic/link traffic at all)

### Reticulum interface add/edit/delete fails

**Symptoms**: Connection tab **Add interface**, **Edit**, or **Delete** shows an inline error; interface list does not refresh.

**Checks**:

1. **Stack running**: start the sidecar from **Connection → Start stack** before editing interfaces. Identity routes on the Network tab also require a live sidecar (`reticulum:proxyGet` / `proxyPut` / `proxyDelete`).
2. **Edit validation**: name is required; TCP needs a reachable host and valid port; RNode needs a serial port path when adding (edit can update preset/callsign without re-plugging). **I2P** peers must be comma-separated `.b32.i2p` hostnames (max **512** characters); inline errors: `i2pPeersRequired`, `i2pPeersInvalid`, `i2pPeersTooLong`. Invalid **mode** values are rejected by the sidecar (`invalid interface mode: …`); use the Connection mode select (or clear to omit). For TCP hub reachability / path seeking, prefer **Boundary** — **Add default backbones** sets/repairs missing mode to `boundary` (does not overwrite a valid user-chosen mode).
3. **Delete**: confirm in the modal; if the interface id changed after config import, refresh by stopping and restarting the stack.
4. **Logs**: filter Device logs for `[ReticulumIPC]` or `[ReticulumSidecar]`; sidecar returns `{ ok: false, error }` for parse or unknown-interface failures.

**TCP / UDP / I2P / Auto / Pipe not active after add**: Sidecar live `apply_interfaces` only hot-applies **BLE Peer**; other types are written to config and require a stack restart. The Connection UI auto-restarts after add/enable/edit/delete for those types (`reticulumInterfaceChangeRequiresStackRestart`). If a transport still does not appear, use **Stop stack** then **Start stack**, or check the amber restart hint. **Add default backbones** still shows the hint only (no auto-restart).

For bulk fixes, use Network **Config import** (merge) instead of hand-editing individual rows. See [reticulum.md — Interface management](reticulum.md#interface-management-connection-tab).

### Reticulum I2P interface stays down

**Symptoms**: Connection → Interfaces shows an enabled I2P row (e.g. **RNS I2P Hub A**) as **down**; Diagnostics may list `reticulum/interface-down`. The I2P router appears running and “clients” look ready, but mesh-client never comes up.

**Checks**:

1. **Interface enabled**: default hub presets (including **RNS I2P Hub A**) are added **disabled**. Enable the row after configuring SAM, then let the UI restart the stack (or Stop/Start).
2. **SAM application bridge**, not I2PTunnel: HTTP/HTTPS proxies on `127.0.0.1:4444` / `4445` (and similar “Client ready” lines) are classic I2PTunnel clients. Reticulum needs the **SAM** bridge (default **`127.0.0.1:7656`** on the mesh-client machine). In the I2P Router Console → **Clients**, enable **SAM application bridge** (Run on load). The Connection ⓘ tooltip on I2P rows covers the local case.
3. **Remote SAM (optional)**: if I2P runs on another LAN host, do **not** put that IP in the typed Host field (that field is hub **peers** / `.b32.i2p`). Edit the I2P interface → **Advanced** and set:

   ```ini
   i2p_sam_host = 192.168.1.86
   i2p_sam_port = 7656
   ```

   Use rsReticulum keys `i2p_sam_host` / `i2p_sam_port` (not Python RNS `sam_address` / `sam_port`). On the I2P router, bind SAM to the LAN address or `0.0.0.0` (localhost-only SAM is unreachable remotely). Confirm from the mesh-client host: `nc -z <sam-host> 7656`. See [reticulum.md — Interface management](reticulum.md#interface-management-connection-tab).

4. **Restart I2P after enabling SAM**: flipping SAM on while the router is already running often does not open `7656` until you fully restart I2P. Confirm something listens on the configured SAM address/port. SAM may also delay ~2 minutes after router boot (`delay=120` in the SAM client config).
5. **Restart the Reticulum stack** after SAM is listening (stack restart alone cannot help while SAM is refused).
6. **Tunnel build time**: first connect to a hub `.b32.i2p` peer can take a while on a fresh router. Sidecar / Device logs may show `I2P client:` / `I2P server:` messages (`failed to connect to SAM bridge`, `STREAM CONNECT failed`, `stream connected`).

### Reticulum Peers stale or slow with many hubs or testnets

**Symptoms**: Peers looks briefly stale after opening the tab, or—after enabling several public hubs or testnets—shows thousands of path-table rows and scrolling, search, or refresh feels sluggish. UI may remain responsive on **History**, **Contacts**, or **Favorites** because those tabs show a smaller set than the full path table.

**Checks**:

1. **Refresh model**: opening Peers uses the sidecar’s short-lived soft cache. Click **Refresh** to force a live path-table read (`?refresh=1`). mesh-client virtualizes peer rows above 100 entries (never mounts the full DOM when the virtualizer is not ready), prepares labels once before filter/sort, and does **not** reload the full path table on high-frequency `stats_update` / `interface.state` WS events. The sidecar still maintains the full RNS path table (often 3k–10k rows on busy hubs). Background peer refresh runs every 30 s while the stack is configured (60 s above 2,000 peers), plus announce/`peers_updated` debounced updates.
2. **Reduce noise**: disable unused TCP/community hub interfaces on **Connection → Interfaces** and restart the stack so RNS drops stale TCP clients. The Amsterdam official testnet hub remains decommissioned (red **decommissioned** badge; **Enable** is blocked) and is auto-disabled on stack start and by **Add default backbones** — focus remaining noise on community hubs you enabled. If an old Amsterdam row keeps turning off, that is expected; use the picker or **Directory ↗** for live hubs.
3. **History vs Contacts**: messaging stamps **History** (`last_heard`) only. Peers you DM show under **History** until you open peer details and choose **Save as contact** (**Contacts** = `is_contact`). **Favorites** pins a short list. Removing a contact keeps History/chat messages.
4. **Search**: the peer search box debounces input and filters the full prepared list (not only the visible window) — wait a moment after typing before judging filter performance on very large lists.
5. **Topology**: automatic topology rebuilds pause above the large-mesh threshold; use its manual **Refresh** after a significant route change.

### RNode Wi-Fi interface offline or won't connect

**Symptoms**: Connection tab shows a Wi-Fi RNode interface as **down**; logs may show TCP connect failures to the configured host.

**Checks**:

1. **Interface type**: use **RNode** with transport **Wi-Fi** (`tcp://192.168.x.x:7633`), not **TCP Client** (mesh upstream on port **4242**).
2. **Provisioning**: Wi-Fi is disabled after flashing until you configure station or AP mode (**Admin → Wi-Fi**, AP + `http://10.0.0.1`, or `rnodeconf`).
3. **IP address**: DHCP may change the RNode IP — update the host on Connection → Interfaces, or set a static IP in Admin → Wi-Fi advanced.
4. **LAN reachability**: the computer running mesh-client must be on the same network as the RNode; check firewall rules for outbound TCP to port **7633**.
5. **Sidecar build**: packaged builds include `rns-rnode-tcp`; dev builds need `pnpm run reticulum:sidecar:build` with `rns-stack,rns-ble,rns-rnode-tcp` features.

See [reticulum.md — RNode over Wi-Fi](reticulum.md#rnode-over-wi-fi).

### Reticulum Admin: RNode flasher timeout or stalled transfer

**Symptoms**: **Reticulum → Admin → RNode flasher** fails with a timeout or stall message after you pick a port and start flashing. UI copy maps internal error tags to i18n hints (`flasher.errors.*`).

| Error tag                   | Typical cause                                                                        | Recovery                                                                                                                                                                                                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`RNODE_COMMAND_TIMEOUT`** | Board not responding on serial (boot loop, wrong port, stack still holding the port) | **Stop stack** (or disable the RNode interface) so the sidecar releases USB; quit other serial tools; wait for boot to finish; retry. Command window: **30 s** (`RNODE_COMMAND_TIMEOUT_MS`). BLE pairing uses a separate **90 s** cap (`RNODE_BT_PAIRING_TIMEOUT_MS`). |
| **`ESP32_FLASH_STALLED`**   | ESP32-S3 flash wrote no progress for **60 s**                                        | Different USB cable/port; hold **BOOT (0)**, tap **RESET (EN)**, release **BOOT** for bootloader mode; flash again.                                                                                                                                                    |
| **`NRF52_DFU_STALLED`**     | nRF52 DFU wrote no progress for **60 s**                                             | Same cable/port/bootloader steps as ESP32; confirm you selected the DFU-capable port.                                                                                                                                                                                  |

**Before flashing**: stop the Reticulum stack or disable the RNode interface — the sidecar holds the serial port while the stack runs (`flasher.errors.blockedByStack`). After a failed flash, power-cycle the board and re-enter bootloader if the port disappears.

### Reticulum Remote transfer fails or `path_constrained`

**Symptoms**: **Reticulum → Remote** rnsh/rncp (or Chat DM send-file) fails with `Path constrained`, `Path unknown`, `Not announced`, or `Timeout`; the path-capability chip is red.

**Cause**: rnsh/rncp gate on the destination's link speed and path table (`stack::path_speed::PathCapability`). A `path_constrained` reason means the known path is too slow/limited for the transfer; other reasons map to `reticulumRemote.reasons.*` via `useRemotePathCapability`.

**What to do**:

1. Confirm the destination is announced and has a path (Peers / Topology); **Probe** it if the chip is stale.
2. For `path_constrained`, prefer a faster interface or wait for a better path; large files over slow links may not be attempted.
3. Check sidecar logs for `rnsh`/`rncp` link errors; the `reticulum:rncpSend` / `rncpFetch` IPC returns the reason key surfaced in the toast.

**Chat DM note**: the destination field is the peer's **`rncp.receive`** hash, not their LXMF/Chat hash. Prefer **Request enable** (mesh-client peers share the receive hash after they accept) or paste from their Remote → **My rncp receive destination**.

**Request enable / 422**: `sendRncpRequestEnable` must POST LXMF with a `text` field (not `content`) — wrong key → HTTP **422**. After you send request-enable, the peer's `mesh-client:rncp-receive-dest:v1:<hash>` reply is applied when present (prefer a pending mark from `rncpReceiveDestSharePending` in this session; shares without that mark are still applied so older peers / pasted hashes autofill). Inbound enable-request modal enqueue and dest-share apply are deduped by LXMF `message_hash` so periodic catch-up / WS duplicates do not re-open the modal or re-toast; when the peer is already listening, dest is auto-shared at most once per peer per outbound request-enable cooldown.

**Sleep / wake**: Suspend clears in-memory rnsh sessions and rncp transfers; reopen Remote (or wait for resume reconnect) after wake. See [Sleep, wake, and long-running sessions](#sleep-wake-and-long-running-sessions).

### Reticulum Remote inbound rncp blocked (Ask mode / policy)

**Symptoms**: Incoming file offers never arrive, or an offer is auto-declined; a peer reports their send was rejected.

**Cause**: Inbound rncp is gated by the listener mode (`RncpInboundMode`: `off` / `ask` / `allow_all_listed`) plus a per-identity allow/block policy (`reticulumInboundPolicyStore`, persisted via `db:*ReticulumInboundPolicy`). `off` drops all offers; `ask` prompts (`RncpEnableRequestModal`); `allow_all_listed` accepts only allow-listed identities.

**What to do**:

1. **Reticulum → Remote → settings**: set the inbound mode and review the allow/block list.
2. In **Ask** mode, respond to the enable-request prompt; a blocked identity stays blocked until you change its policy row.
3. The listener config persists in `mesh_client_stack.json` (`rncp_listener_*`) and restores on live stack start — re-enable after a factory reset.

### Reticulum hung-sidecar watchdog restart

**Symptoms**: Logs show `[reticulumSidecarWatchdog] hung poll failure` then `restarting hung sidecar`; the stack briefly drops and recovers on its own.

**Cause**: The main-process watchdog (`reticulumSidecarWatchdog.ts`) polls `/api/v1/status` every **30 s** while the sidecar process is alive. After **2** consecutive unresponsive polls (5 s fetch timeout) it attempts **one** restart. Process-exit crashes are not handled here — those are owned by the renderer autostart path.

**What to do**: Usually no action; the watchdog recovers a wedged-but-alive sidecar. If restarts loop, check for a stuck link/interface or resource exhaustion in the sidecar log and **Stop stack** to clear state.

## Chat, nodes, and notifications

### Meshtastic: inbound messages on the wrong channel tab

**Symptoms**

- Public mesh traffic appears under your **primary/private** Chat channel pill instead of the configured public slot (often channel 1).
- The same message may appear on two channel tabs when heard over **RF** (correct slot) and **MQTT** (wrong slot).
- Other Meshtastic clients (phone app, radio UI) show the message on the expected channel.

**Cause**

MQTT ingest must map inbound text to the **receiver's** local channel slot using the MQTT topic channel name (`LongFast`, regional names, etc.) via `channelNameToIndex`. `MeshPacket.channel` in the ServiceEnvelope is the **sender's** local RF slot and must not drive attribution — remote gateways often use a different slot layout (e.g. LongFast on slot 1 while you use slot 0).

Mis-filed messages also occur when `channelNameToIndex` is stale or incomplete: unnamed default-public on slot 1 without radio sync, MQTT-only without `ChannelName@index=` manual PSK lines, or MQTT connecting before RF channel configs arrive (cold-start empty map).

**Fix**

1. Update to a build that prefers the **topic channel name** for MQTT text ingest (sampled log `mqtt-channel-topic-mismatch:*` when topic index disagrees with packet channel).
2. Connect the radio so channel keys and slot indexes sync to MQTT. Current builds **re-push** `mqtt:updateChannelKeys` when RF `resolvedChannelConfigs` land after MQTT is already connected — look for `[Meshtastic MQTT] channelNameToIndex updated` in the App log (e.g. `LongFast=1`).
3. **MQTT-only (no radio):** add `ChannelName@index=base64` lines in Connection → Channel PSKs (e.g. `LongFast@1=AQ==` for Colorado-mesh slot-1 public). The Connection panel shows an inline hint when no radio is configured and no `@index` lines are present.
4. On **Export for Developer** / **Copy Debug Snapshot**, check `meshtastic.channelPills`, `meshtastic.channelConfigsSummary`, `meshtastic.mqttChannelKeyEntryCount`, and `meshtastic.mqttChannelNameToIndex` (main-process topic→slot map; e.g. `{ "LongFast": 1 }` for Colorado-style public on slot 1). Slot 1 with empty name and `isDefaultPublicPsk: true` is the common Colorado-mesh layout.
5. When reporting, note whether mis-filed messages are **MQTT-only**, **RF-only**, or **both**, and attach a Radio tab screenshot of channel names + slot indices.

### MeshCore-flashed radio still “Just now” on Meshtastic Nodes

**Symptoms**

- After flashing a radio from Meshtastic to MeshCore, the old Meshtastic NodeDB row (often short name / MAC-derived `!xxxxxxxx`) stays **online** / **Just now** on the Meshtastic tab while that hardware is the connected MeshCore BLE radio.
- Hops often show **0**; MQTT column may be `-` (RF-style refresh).

**Cause**

Meshtastic node numbers are frequently the lower 32 bits of the BLE MAC. With both a Meshtastic radio and that MeshCore radio on the same band, Blck (Meshtastic) can still “hear” MeshCore TX and bump `last_heard` on the **existing** stale NodeDB row (raw packet SNR path / MQTT minimal updates) without a real Meshtastic NodeInfo.

**Fix**

1. Update to a build that suppresses Meshtastic `last_heard` bumps for node IDs matching the **remembered/connected MeshCore BLE MAC** (`connectedMeshcoreBleMac.ts`). A valid MAC is **persisted and pre-armed** across cold start, failed reconnect, and user disconnect; it clears only on **Forget** or switching MeshCore to a non-BLE transport.
2. Until then: delete the ghost node on Meshtastic Nodes (it may return while both radios are on-air on older builds).
3. Confirm MeshCore Connection is BLE to that peripheral; Diagnostics foreign-LoRa is separate from the Nodes list.

### Phantom chat unread on channels not on the radio

**Symptoms**

- Sidebar **Chat** badge or channel pills show unread counts on MeshCore channels you did not configure (zero PSK / not on the radio).
- Badge counts disagree between the sidebar and Chat channel pills after upgrade or protocol switch.
- **Copy Debug Snapshot** shows messages on `ch:1` (or higher) while the radio only has channel 0 configured.

**Cause**

Stale `mesh-client:lastRead:<protocol>` watermarks (including legacy merged keys) or DB messages on channel indices the radio no longer uses. MeshCore unread badges intentionally ignore zero-PSK slots; poisoned last-read values can still inflate counts until sanitized.

**Fix**

1. Open **Chat**, visit each configured channel once (marks last-read), or use **App → Data Management → Copy Debug Snapshot** to confirm channel indices vs runtime channels.
2. If counts persist after visiting channels, clear last-read for the protocol in browser devtools (`localStorage.removeItem('mesh-client:lastRead:meshcore')` or `meshtastic`) and reload — you will lose per-channel read state.
3. For stuck sidebar totals with live traffic in logs, see [Chat stuck](#chat-stuck-new-traffic-in-logsdb-but-messages-do-not-appear) and attach a debug snapshot when filing an issue.

### Chat stuck: new traffic in logs/DB but messages do not appear

**Symptoms**

- BLE/MQTT show connected; **Log** or SQLite still records new messages.
- Chat scroll area jumps or unread badges move, but **message list stops updating** (often after reconnect or protocol switch).
- A **Copy Debug Snapshot** may show `identitySplit: true`, `staleResolvedBucket`, or `connectMessageCount` newer than `uiStoreMessageCount`.

**Cause**

Live packets were written to the **connected identity** store bucket while Chat read the **offline hydration** bucket (`offline-meshcore` / `offline-meshtastic`). This could happen when the connected identity was empty on reconnect and the UI fell back to the hydration slot even though ingress had resumed on the live id.

**Fix**

1. Update to a build that includes the identity-bucket fix (merge on connect, stricter offline fallback, reactive identity resolution).
2. **Disconnect and reconnect**, or quit and reopen the app so offline slices merge into the connected identity.
3. If Chat is still stale: use **App → Support / Bug reports → Export for GitHub** and attach the zip to your issue; check `warnings` and `sessionSummary` in `debug-snapshot.json`.
4. As a last resort before clearing data: **App → Export Database**, then try **Import (merge)** after updating — do not downgrade the app after migrations.

This is **not** SQLite corruption when messages persist in the DB during the stuck window; it was a UI store routing mismatch.

### Chat freeze burst: unread badges move but list jumps when opening Chat (fixed in newer builds)

**Symptoms**

- While on **Connection**, **Nodes**, or **Log**, sidebar unread badges update for new traffic.
- Opening **Chat** shows several missed messages at once ("flood in"), even though RF/MQTT delivery was fine on another radio.

**Cause (5.20.x and earlier)**

Chat used a freeze-on-leave snapshot: `messagesForUnread` stayed live for badges, but the scroll list kept a stale snapshot until you returned to Chat.

**Fix**

- Update to a build that passes **live** messages to Chat at all times (`ChatPanel` `isActive` guards prevent scroll/read side effects while hidden).
- **Workaround on older builds:** stay on the **Chat** tab while monitoring live traffic.

### MeshCore USB serial: messages arrive in batches (waiting-queue drain)

**Symptoms**

- On **USB serial**, inbound MeshCore messages may appear several at a time after a short delay, even while **Chat** or **Rooms** is active.
- **Log → debug** may show repeated `getWaitingMessages timed out` or `processWaitingMessages skipped (in flight)`.

**Cause**

The companion radio queues public messages behind a **single serialized USB serial lane** shared with repeater admin, init RPCs, and MsgWaiting drains. Older builds bulk-fetched the whole queue before updating the UI.

**In-app status**

The **header status indicator** (queued backlog and active sync on any protocol tab; **paused/deferred** state only on the MeshCore tab) shows silent auto-drain or deferred drain behind admin/trace work. On serial, messages may arrive in small batches without a Chat/Rooms panel banner.

**Fix / workaround**

1. Pause repeater **Status / Neighbors / ping** while monitoring live chat on serial.
2. Prefer **BLE** or **TCP** when available for lower-latency chat.
3. If drains stall, **Disconnect → Connect** or quit and reopen after repeated timeouts in the log.
4. Use **Sync now** from the **header waiting-messages indicator** for a large backlog (determinate progress in the header tooltip/status).

### Chat or Rooms: scroll jumps when switching tabs

**Symptoms**

- Leaving **Chat** or **Rooms** and returning jumps to the bottom, or scroll position is lost, even when you were reading older messages.

**Cause**

Older builds remounted panel content on tab switch. Recent fixes restore scroll position on re-entry and only auto-scroll to latest when you were already pinned to the bottom.

**Fix**

- Update to the latest release.
- If you were scrolled up reading history, the panel should return to the same position after tab switch.
- If you were at the bottom, new messages should still scroll into view on return.

### Nodes list shows wrong protocol labels or mixed Meshtastic/MeshCore rows

**Symptoms**

- Meshtastic **Nodes** includes MeshCore-only contacts (or vice versa) after upgrading from an older database.
- Room-server rows appear under the wrong protocol tab.

**Cause**

Legacy SQLite rows could cross-contaminate the shared `nodes` table before protocol-scoped identity stores. Startup maintenance now repairs and guards ingest on current builds.

**Fix**

- Update to the latest release and **restart once** so idempotent startup repairs run (`db-schema-sync`).
- If the list is still wrong, export the DB, note your app version, and file an issue with **Export for GitHub** (or **Copy Debug Snapshot** for a quick paste) + **Log → Export**.

### Chat notification sounds when the window is minimized

**Symptoms**

- No sound for DMs/replies when the app is in the background, or only a single tone for all message types.

**Fix**

- Check **App** notification mute and per-channel/DM mute in Chat.
- Recent builds use distinct Web Audio tones (channel vs DM/reply) and resume audio when the window is hidden or minimized. Ensure the app is not globally muted (`mesh-client:notifMuted` in localStorage clears when you re-enable sounds in UI).

**Meshtastic desktop notifications** remain visual-only (`silent: true`); typed sounds come from the app’s Web Audio path.

## Diagnostics and map

### Diagnostics panel: "restored from last session" banner

**Cause**: Diagnostic rows (routing + RF) are snapshotted to `localStorage` so a restart doesn't wipe the table.

**Fix**: This is expected; rows refresh as new packets arrive. Use **Stop restoring on next launch** on the banner to clear the snapshot, or use **App** tab → **Reset Diagnostics** to clear in-memory rows and related state.

**Note**: On startup, restored rows stay visible until the node list hydrates from SQLite. An early `runReanalysis` with an empty node map no longer clears the snapshot (fixed in `diagnosticsStore.runReanalysis`). Rows still refresh once live telemetry arrives.

### Diagnostics look stale or overcrowded

**Cause**: RF rows age out faster (default 1 h) than routing rows (default 24 h); very old rows are pruned by timestamp.

**Fix**: In **Network Diagnostics** → Display Settings, adjust **diagnostic row max age** (hours). Or reset diagnostics from the App tab and let the mesh repopulate.

### Diagnostics: health band OK but anomaly table empty

**Symptoms**: Network health shows **Healthy** (or low warning count) and foreign-LoRa / settings sections render, but the main routing/RF anomaly table has no rows.

**Cause**: Often expected when the mesh has no active hop or RF findings for the **current protocol tab**. LoRa rows are recomputed from that tab's nodes only; switching tabs clears routing/RF state and re-runs analysis. Reticulum interface rows do not appear on Meshtastic/MeshCore tabs (and vice versa).

**Fix**: Confirm you are on the protocol tab that owns the finding (e.g. Reticulum interface-down on **Reticulum**). For Meshtastic CU timeline / connected-node RF rows, ensure the radio is configured and sending LocalStats telemetry. See [Diagnostics Reference](diagnostics.md#multi-protocol-tab-scoping).

### Diagnostics: foreign LoRa only on Meshtastic tab

**Symptoms**: MeshCore-heard or Reticulum traffic tables missing on MeshCore or Reticulum tabs.

**Fix**: Foreign-LoRa overhear tables render on the **Meshtastic** and **MeshCore** Diagnostics tabs (keyed by that protocol’s self node id). Reticulum RNode promiscuous foreign LoRa is not implemented (sidecar tap exposes parsed RNS frames only).

### No signal bars on some nodes

**Cause**: Signal strength is only available for **direct (0-hop) RF** neighbors. Multi-hop and MQTT-heard nodes have no client-side signal strength.

**Fix**: Not a bug; use SNR/last heard and routing diagnostics instead for those paths.

### Map tab without internet (offline / no WAN)

**Basemap tiles:** The map background uses **OpenStreetMap** by default (or **Carto Dark** if selected). On the Map tab, use the **Layers** control under the **online/stale/offline** status counts (top right) to switch basemaps and toggle overlays (node markers, movement trails, waypoints, diagnostic halos). The `TileLayer` is defined in [`MapPanel.tsx`](https://github.com/Colorado-Mesh/mesh-client/blob/main/src/renderer/components/MapPanel.tsx). **Without internet access, new tiles cannot be fetched**, so the basemap may look **blank, gray, or incomplete**, or show only **tiles previously cached** by the embedded browser (caching is best-effort and not guaranteed).

**Overlays:** **Node markers, polylines, position trails, and other vector layers** are separate from the tile layer. If nodes have latitude/longitude (from RF, MQTT, SQLite, or your session), those overlays can still **render on top of a missing or partial basemap**.

**Your position offline:** Use **device GPS** when available, **Fixed Position** on the **Radio** tab, or **static coordinates** in app/GPS settings. See **GPS "Location unavailable" or stuck on the map** above for IP-based fallbacks and manual entry. Positions heard over the mesh do not require internet.

### Verifying offline behavior (manual QA)

With **Wi‑Fi off** or **airplane mode** on, using a **packaged** build if possible:

1. Confirm the app **window loads** and core tabs work; connect via **USB serial** or **BLE** to a local radio if you need RF features.
2. Open the **Map** tab: expect **missing or stale basemap tiles** as described above; **markers and trails** may still appear when position data exists.
3. A non-fatal **update check** message in the console is expected without WAN; see **Update check fails / footer update status** above.

## App, updates, and localization

### GPS "Location unavailable" or stuck on the map

**Cause**: Browser geolocation was denied, or the device has no GPS fix yet.

**Fix**:

- Grant location permission when prompted by the app.
- Or set coordinates manually via the **Radio** tab → Fixed Position.
- Note: The IP-geolocation fallback (ipwho.is) provides city-level accuracy only; not suitable for position broadcasting. If the service is unreachable, "Location unavailable" is shown.

### "Something went wrong" blank screen

**Cause**: An unhandled React render error, usually from a corrupt or unexpected database value.

**Fix**: Open the **App** tab → **Clear Database**, then restart. If the window never loads at all, delete the SQLite file manually:

- **Mac**: `~/Library/Application Support/mesh-client/`
- **Windows**: `%APPDATA%\mesh-client\`
- **Linux**: `~/.config/mesh-client/`

### macOS: "representedObject is not a WeakPtrToElectronMenuModelAsNSObject" when typing in chat

**Cause**: Known Electron/Chromium quirk on macOS when the first responder is a text field (e.g. the chat input). The native menu bridge logs this; it does not affect behavior.

**Fix**: None required; safe to ignore. Copy/paste and other edit actions still work.

### Update check fails / footer update status

The app functions fully offline; this is not a critical error. If "Update check failed" appears in the console, verify network connectivity. Update checks are rate-limited by the GitHub API and may silently skip when the limit is reached. The footer shows **Update error** when a check fails; use **Check for updates** in the app menu or retry from the footer when applicable.

### Language and Translations

**How do I change the language?**

Click the **globe icon** in the header to select from the 16 supported languages. Your preference is saved across restarts.

**A translation is incorrect or missing.**

Translations are machine-generated using MyMemory and may contain errors. If you find a mistake, please open a [Translation Error issue](https://github.com/Colorado-Mesh/mesh-client/issues/new?assignees=&labels=translation&template=translation-error.md&title=Translation+Error) on GitHub with the correct text.

**Why are some strings still in English?**

The app falls back to English for any key that hasn't been translated into your selected language yet. Translations are bundled statically at build time; new translations will appear in the next app update.
