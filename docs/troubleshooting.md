# Troubleshooting

Build, compile, and local packaging problems are in [development-environment.md — Build troubleshooting](development-environment.md#build-troubleshooting). MeshCore and Reticulum have their own pages: [MeshCore troubleshooting](troubleshooting-meshcore.md) and [Reticulum troubleshooting](troubleshooting-reticulum.md). This page covers runtime failures, connections, and packaged installs.

## Contents

- [Quick reference](#quick-reference)
- [System requirements](#system-requirements)
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
- [TAK (CoT gateway)](#tak-cot-gateway)
- [Chat, nodes, and notifications](#chat-nodes-and-notifications)
- [Diagnostics and map](#diagnostics-and-map)
- [App, updates, and localization](#app-updates-and-localization)
- [MECP (emergency reports)](#mecp-emergency-reports)

## Quick reference

Start here for log analysis, bug reports, and general connection debugging.

### Connection or transport issues: use Log **Analyze**

Open the **Log** panel (right rail), enable **debug** if needed, reproduce the problem, then click **Analyze**. The app scans recent buffered log lines for patterns (BLE, serial, TCP, MQTT, handshake timeouts, etc.) and lists **suggested next steps**. This complements export/delete: use it before filing an issue so you have concrete log context. Analysis is **heuristic**; treat recommendations as hints, not guarantees. Expand **View evidence** on a finding to inspect its timestamped log lines. **Copy troubleshooting report** copies the findings, specific advice, and recent samples for a support request; review the samples before sharing. See [Log analysis](log-analysis.md) for scope and limitations.

### Reporting bugs: **Export for GitHub** (App tab)

Before opening a GitHub issue, use **App → Support / Bug reports → Export for GitHub**. This writes one zip with the debug snapshot JSON and application log file(s) — the same artifacts maintainers previously asked for in three separate steps. The snapshot includes **Reticulum** sidecar status, interface diagnostics, and config audit when the stack was running at export time (`reticulum` section in `debug-snapshot.json`; `[ReticulumSidecar]` lines in the log).

Open `manifest.json` first when triaging: `appVersion` is package semver; **`buildChannel`** is `test` (Build Binaries / Flatpak no-release), `release` (official Release or Flatpak tag), or `local` (unmarked local dist). For CI builds, `buildInfo.runUrl` links to the exact GitHub Actions run — do not assume `appVersion` alone means an official release. Test-build downloadable installers include `-run{N}` in the filename; if the filename and `runUrl` disagree, trust `runUrl` / the `[Startup] runtime … run=` log line.

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

| Field                                                                   | Healthy connected example | Meaning                                                                                                    |
| ----------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `sessionSummary.<protocol>.liveSession`                                 | `true`                    | RF/MQTT session is live                                                                                    |
| `sessionSummary.<protocol>.sessionState`                                | `"live"`                  | Not DB-hydrated-only                                                                                       |
| `activeTab.liveSession`                                                 | `true`                    | Active protocol tab is connected                                                                           |
| `warnings`                                                              | `[]`                      | No stuck-chat signatures detected                                                                          |
| `mainLiveness` (top-level)                                              | object                    | `mainUptimeSec`, `lastRendererHeartbeatAgeMs`, `rendererUnresponsiveSeen`, `rss`, `heapUsed` — hang triage |
| `meshcore.roomsUnreadEstimate`                                          | number                    | Computed Rooms tab badge (known room servers only)                                                         |
| `meshcore.orphanRoomMessageCount`                                       | number                    | Room posts whose `room_server_id` is not in current contacts                                               |
| `meshcore.roomNodeCount` / `roomMessageCount` / `roomsLastReadKeyCount` | numbers                   | Rooms triage counts                                                                                        |

Zip contents also include **`mesh-client.log.1`** when present (prior session preserved on restart, or size-rotated backup; export may tail-cap large backups). When present, support bundles also include **`mecp-received.log`** / **`mecp-received.log.1`** (durable MECP emergency audit trail — separate from the session app log).

The top-level **`legend`** explains that ids like `offline-meshcore` are **internal hydration-slot store keys**, not “disconnected.” When connect reuses that slot (`hydrationSlotIsLiveSession: true`), the id still contains `offline-` while BLE/MQTT are up — that is **expected**.

**Per-protocol bucket fields** (under `meshtastic` / `meshcore`; Reticulum uses `reticulum.bucket` with the same shape):

- `hydrationSlotId` — pre-connect DB hydration bucket (`offline-meshtastic` / `offline-meshcore` / `offline-reticulum`).
- `connectIdentityId` — connected radio/MQTT identity.
- `uiStoreIdentityId` — bucket Chat and Nodes read from.
- `identitySplit: true` while transport is connected — **suspicious** (live ingress and UI may disagree).
- `ui.chatPanelFrozen` + `frozenMessageCount` lagging `liveResolvedMessageCount` — **legacy snapshots only** (current builds always emit `chatPanelFrozen: false`; the freeze path was removed). Ignore unless analyzing an older export.
- `ui.waitingMessagesSilentDrainActive` / `ui.waitingMessagesDrainDeferred` — MeshCore waiting-message drain in progress or paused behind admin/trace. Auto-drain prefers bulk `getWaitingMessages` (header shows **X / Y** when the radio returns a queue); on bulk timeout it falls back to one-at-a-time `syncNextMessage` (header shows **Fetched N…**, no fake total). Serial may still feel batchy. UI: **header status indicator** (queued backlog visible on any protocol tab; **active sync spinner and paused/deferred** state only on the MeshCore tab), not Chat/Rooms panel strips.
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

## System requirements

Packaged Mesh-Client (Electron **44**) needs:

| Platform    | Minimum                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| **macOS**   | **13 Ventura** or later (`LSMinimumSystemVersion` in the app bundle; Monterey is not supported) |
| **Windows** | Windows 10 version **1809+** or Windows 11                                                      |
| **Linux**   | x86_64 or aarch64 (AppImage, `.deb`, `.rpm`, Flatpak)                                           |

If the app will not launch on an older macOS, upgrade the host OS — this is not a Gatekeeper quarantine issue. See also [README — System requirements](../README.md#system-requirements).

## Development and building

Clone, compile, and local packaging issues moved to [development-environment.md — Build troubleshooting](development-environment.md#build-troubleshooting):

- [`pnpm install` fails on native module compilation](development-environment.md#pnpm-install-fails-on-native-module-compilation)
- [Windows: "Could not find any Visual Studio installation to use"](development-environment.md#windows-could-not-find-any-visual-studio-installation-to-use)
- [Windows: "Could not find any Python installation to use" (e.g. when building `@serialport/bindings-cpp`)](development-environment.md#windows-could-not-find-any-python-installation-to-use-eg-when-building-serialportbindings-cpp)
- [Linux development: SIGILL during `pnpm install`](development-environment.md#linux-development-sigill-during-pnpm-install)
- [Linux development: SIGSEGV on startup](development-environment.md#linux-development-sigsegv-on-startup)
- ["A native module failed to load" dialog on startup](development-environment.md#a-native-module-failed-to-load-dialog-on-startup)
- [`pnpm run dist:mac` fails with `GH_TOKEN` / "Cannot cleanup"](development-environment.md#pnpm-run-distmac-fails-with-gh_token--cannot-cleanup)
- [`[DEP0190]` when running electron-builder](development-environment.md#dep0190-when-running-electron-builder)
- [`duplicate dependency references` during dist](development-environment.md#duplicate-dependency-references-during-dist)
- [`dist:win` fails with "space in the path" or `EPERM` on native modules](development-environment.md#distwin-fails-with-space-in-the-path-or-eperm-on-native-modules)
- [Windows: `0x80010135` / "Path too long" (e.g. `bluetooth_hci_socket.lastbuildstate`)](development-environment.md#windows-0x80010135--path-too-long-eg-bluetooth_hci_socketlastbuildstate)
- [`[DEP0169]` / `url.parse()` deprecation warning](development-environment.md#dep0169--urlparse-deprecation-warning)

## Installation and packaged apps

Installers, Flatpak, Gatekeeper, and first-launch failures.

### Linux packaged app: `Cannot find module 'readable-stream'`

**Symptom**: On Linux, the installed or AppImage build shows a main-process error when loading MQTT (`bl` → `mqtt-packet` → `mqtt` require stack).

**Cause**: With a hoisted `nodeLinker`, electron-builder can omit some transitive packages from `app.asar` unless a full copy exists at a predictable path (historically worsened when `pnpm list --json` marked nodes as deduped). `mqtt` is loaded from `node_modules` at runtime (not bundled into the main esbuild output).

**Fix in this repo**: `readable-stream@^4.8.0` is a **direct** production dependency (with the existing `patches/readable-stream@4.8.0.patch` for Windows `process/` resolution). Do not remove it when bumping `mqtt` or pnpm. After `pnpm run dist:linux`, verify the asar contains `node_modules/readable-stream`, `node_modules/bl`, and `node_modules/mqtt`. See [electron-builder#9603](https://github.com/electron-userland/electron-builder/issues/9603) and [pnpm#10601](https://github.com/pnpm/pnpm/issues/10601).

### Permission messages in the console

The session allowlist grants **serial**, **geolocation**, and **media** (camera for QR ingest; microphone for Reticulum LXST voice calls). Other permissions such as `web-app-installation` remain denied and may appear as `[permissions] … → denied` in the log.

If microphone permission is denied when placing or answering an LXST voice call:

- **macOS:** System Settings → Privacy & Security → Microphone — allow Mesh-client (or Electron when running `pnpm run dev`). Packaged builds include `NSMicrophoneUsageDescription`.
- **Windows:** Settings → Privacy & security → Microphone — allow desktop apps / Mesh-client. The app opens this page when OS status is `denied`.
- **Linux:** Ensure PulseAudio or PipeWire can capture; Flatpak builds already include `--socket=pulseaudio`. AppImage/deb use the host audio stack.

If QR camera scanning fails with camera permission denied:

- **macOS:** System Settings → Privacy & Security → Camera — allow Mesh-client (packaged builds include `NSCameraUsageDescription`). `media:ensureCameraAccess` opens the privacy pane when denied.
- **Windows:** Settings → Privacy & security → Camera — allow desktop apps / Mesh-client.
- **Linux:** Chromium/portal behavior; no separate Electron privacy deep link.
- Streams are stopped after a successful decode, Stop camera, and component unmount (no orphaned tracks).

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
2. Download the **arm64** installer from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases): `Mesh-client-Setup-{version}-arm64.exe` (not the x64-only `Mesh-client-Setup-{version}.exe`). Older releases may show dotted GitHub names (`Mesh-client.Setup.{version}-arm64.exe`) — use that file if the hyphenated name is missing.
3. Re-run the installer. Confirm `Mesh-client.exe` exists in the install folder and the app appears in **Installed apps**.

**Diagnostic checklist (if the exe is still missing)**

Capture this before opening a GitHub issue — it helps isolate NSIS extract vs copy vs policy blocks:

1. **NSIS install log** — run the installer from Command Prompt or PowerShell with logging:
   ```bat
   "Mesh-client-Setup-{version}-arm64.exe" /LOG=%USERPROFILE%\Desktop\mesh-install.log
   ```
   After failure, open `mesh-install.log` and search for `Mesh-client.exe`, `CopyFiles`, or `error`.
2. **Event Viewer** — **Windows Logs → Application** during the install window; note any errors from `MsiInstaller`, `Application Error`, or antivirus agents.
3. **Controlled folder access** — **Windows Security → Virus & threat protection → Ransomware protection**; if enabled, try temporarily allowing the installer or install to a short path such as `C:\mc-test` (see step 5).
4. **Install path** — confirm `%LOCALAPPDATA%` is on a local NTFS volume, not OneDrive-redirected or sync-rooted.
5. **Custom install directory** — test a short path:
   ```bat
   "Mesh-client-Setup-{version}-arm64.exe" /D=C:\mc-test /LOG=%USERPROFILE%\Desktop\mesh-install.log
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

### macOS: Library not loaded: Squirrel.framework after ZIP extract

**Symptom:** Mesh-client crashes immediately on launch (often on macOS 26 / Tahoe). Crash Reporter or Console shows:

```text
Termination Reason: Namespace DYLD, Code 1, Library missing
Library not loaded: @rpath/Squirrel.framework/Squirrel
Referenced from: .../Electron Framework.framework/Versions/A/Electron Framework
```

Similar errors may mention `Mantle.framework` or `ReactiveObjC.framework`. Electron Framework may load; the sibling auto-update frameworks fail first.

**Cause:** The **macOS `.zip`** from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases) was extracted with a tool that **does not preserve macOS framework symlinks** — especially **7-Zip**, and sometimes Finder Archive Utility. That flattens entries such as `Squirrel.framework/Squirrel` into tiny invalid files, so dyld aborts at launch. The release artifact itself is fine; the installed `.app` bundle is broken.

**Fix:**

1. Delete the broken copy (for example `/Applications/Mesh-client.app`).
2. Reinstall using one of these (preferred first):
   - **`.dmg` (recommended):** open the arm64 DMG, drag **Mesh-client** to **Applications**, launch from there.
   - **`.zip` with [Keka](https://www.keka.io/en/)** or Terminal:
     ```bash
     ditto -xk Mesh-client-*-arm64-mac.zip ~/Desktop/mesh-extract
     ```
     Then move `Mesh-client.app` to `/Applications`.
3. **Do not** re-extract the macOS ZIP with **7-Zip**.

**Optional check** after a good install:

```bash
ls -la /Applications/Mesh-client.app/Contents/Frameworks/Squirrel.framework
file /Applications/Mesh-client.app/Contents/Frameworks/Squirrel.framework/Versions/A/Squirrel
```

Expect `Squirrel` and `Versions/Current` to be **symlinks**; `Versions/A/Squirrel` should report a Mach-O dylib (not a tiny text file).

Official releases also ship `00-READ-ME-BEFORE-EXTRACTING-macOS-ZIP.txt` on the release page, and the DMG includes **IMPORTANT-Read-Me.txt** with the same guidance.

### macOS: `codesign --verify --deep --strict` fails after install

**Symptom:** Gatekeeper / `spctl --assess` accepts the app as **Notarized Developer ID**, but:

```bash
codesign --verify --deep --strict --verbose=4 /path/to/Mesh-client.app
# Mesh-client.app: invalid signature (code or signature have been modified)
```

Nested Electron / Squirrel frameworks or Helper apps may report the same error.

**Cause:** Almost always a **locally damaged copy**, not a post-sign rewrite on GitHub Releases. Official DMGs are signed, notarized, and stapled; release CI runs `codesign --verify --deep --strict` plus `xcrun stapler validate` on the finished app inside each DMG/ZIP when the build is Developer ID signed. Flattened framework symlinks (bad ZIP extract) or a broken Finder copy can invalidate the seal. A stapled notarization ticket may still be present after that damage, but the damaged bundle can still fail code-signature validation or Gatekeeper assessment.

**Check the pristine artifact first** (prefer the DMG mount, not a hand-copied tree):

```bash
mkdir -p /tmp/mesh-dmg
trap 'hdiutil detach /tmp/mesh-dmg 2>/dev/null || true' EXIT
hdiutil attach -readonly -nobrowse -mountpoint /tmp/mesh-dmg Mesh-client-*-arm64.dmg
codesign --verify --deep --strict --verbose=4 /tmp/mesh-dmg/Mesh-client.app
spctl --assess --type execute --verbose=4 /tmp/mesh-dmg/Mesh-client.app
xcrun stapler validate /tmp/mesh-dmg/Mesh-client.app
```

Or extract the ZIP with `ditto -xk` (not 7-Zip) and verify that tree. If the mounted DMG / `ditto` extract passes but `/Applications/Mesh-client.app` fails, reinstall from the DMG and delete the broken copy. See [Library not loaded: Squirrel.framework](#macos-library-not-loaded-squirrelframework-after-zip-extract) above.

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

**Cause**: The Flatpak sandbox mounts an empty `/tmp/.X11-unix`, so Electron cannot fall back to X11 unless the wrapper passes Wayland/Ozone flags. Older bundles also omitted Chromium sandbox flags and `TMPDIR` setup that zypak expects. A different immediate exit with `No usable sandbox!` on hardened hosts is covered in [Flatpak: "No usable sandbox!" on Ubuntu 23.10+ / hardened Linux](#flatpak-no-usable-sandbox-on-ubuntu-2310--hardened-linux).

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

### Flatpak: "No usable sandbox!" on Ubuntu 23.10+ / hardened Linux

**Symptom**: `flatpak run org.coloradomesh.MeshClient` exits immediately with no window. The terminal may show `zypak-helper` lines (for example `Wait found events, but sd-event found none`) followed by:

```text
FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:129] No usable sandbox!
```

**Cause**: The host blocks **unprivileged user namespaces** (common on **Ubuntu 23.10+** with AppArmor `apparmor_restrict_unprivileged_userns`, and on some hardened **Fedora** / **Arch** setups). The Flatpak wrapper passes `--disable-setuid-sandbox` (zypak owns Chromium sandboxing), so when user namespaces are unavailable Chromium has no usable sandbox and aborts.

**Fix in app**: Current releases auto-retry with `--no-sandbox` when this fatal is detected (same fallback as `pnpm start` via `scripts/start-electron.mjs`). Reinstall the latest `.flatpak` from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases) if you are on an older bundle.

**Workaround** (skip the probe, force `--no-sandbox` on first launch):

```bash
MESH_CLIENT_NO_SANDBOX=1 flatpak run org.coloradomesh.MeshClient
```

The **outer Flatpak bubblewrap sandbox** still isolates the app when Chromium runs with `--no-sandbox`; only the inner Chromium namespace sandbox is relaxed.

**Host root-cause fix** (optional — restores the inner Chromium sandbox): allow unprivileged user namespaces on the host, or add an AppArmor profile exception. See the upstream Chromium guide: [AppArmor userns restrictions](https://chromium.googlesource.com/chromium/src/+/main/docs/security/apparmor-userns-restrictions.md). On older kernels, `kernel.unprivileged_userns_clone=1` may also be required — see [Linux launch notes](development-environment.md#linux-launch-notes) in development-environment.md.

## Database and local data

### Database schema upgrade (forward — first launch after a newer build)

**Symptom**: On first launch after installing a newer release, a blocking **Quit / Upgrade** dialog asks to confirm an irreversible SQLite schema upgrade. Packaged installers may also ship `SCHEMA-UPGRADE.txt` in the app resources.

**Cause**: This build’s `user_version` is higher than the existing profile database.

**Fix**: Choose **Upgrade** to migrate (cannot roll back with an older app against the same profile), or **Quit** and restore a backup / use a fresh profile. CI/E2E may set `MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE=1` to skip the dialog (dev/unpackaged only when restricted). See [release-process.md](release-process.md) for installer notice text.

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

#### BLE debug: MTU negotiation in logs

- After sidecar GATT connect, ATT MTU may still be negotiating; write sizing uses `bleAttWriteLimit.ts` (spec min **23**).
- **Slow NodeDB / large config sync over BLE** can still be limited by **`@meshtastic/core`** queue timing (hundreds of ms between queued packets), not only GATT MTU. Use **Log → Analyze** for hints, or try **USB serial** / **TCP** if throughput matters.

**Windows-specific:**

- The app pairs LoRa radios itself on Windows: when you pick a device or click Reconnect, it checks the pairing state and, if the radio is not paired, asks for the PIN (MeshCore: the PIN on the radio's screen; Meshtastic: prefilled `123456`) before connecting. Pairing only in **Settings → Bluetooth & devices** can leave some radios (for example the L1 Pro MeshCore companion) half-paired, which stalls the connection.
- If the pair-state check times out or pairing fails, the app does not connect and offers **Remove & Re-pair Device**. Use it, or remove every entry for the radio in **Settings → Bluetooth & devices** and try again.
- **Paired, Windows shows the radio as "Connected", but mesh-client will not connect:** a MeshCore companion stops advertising while any central holds its link (the Windows pairing link, or another app such as the MeshCore desktop app), so a scan cannot find it. When the scan misses a radio that Windows reports as connected, the app connects to it by Bluetooth address instead (log line `peripheral not advertising — connecting by address (windows)`). A radio that Windows does not report as connected is treated as absent (`… skipping address fallback`). If the connection still fails, close other apps that use the radio (MeshCore desktop or phone app), power-cycle the radio, and connect again.
- **The radio shows up in the scan list, but connecting fails with `Bluetooth stack unresponsive` (or `connect timed out` / `GATT setup timed out`):** the radio was found, but Windows never finished the GATT connection. The `gatt connect stage` lines in the log (`lookup`, `found`, `connect`, `discover_services`, `subscribe`) show which step stalled. Close other apps connected to the radio, toggle Bluetooth off and on, power-cycle the radio, and retry. If it keeps failing, export a developer support bundle.

**Linux-specific:**

- LoRa BLE uses the reticulum-sidecar **btleplug** stack (same as macOS/Windows), not Web Bluetooth. You still need a working Bluetooth stack (`systemctl status bluetooth` / `rfkill list`).
- **Flatpak:** Ensure the package allows Bluetooth (`--allow=bluetooth` with BlueZ talk-name). If pairing tools are missing in the sandbox, use the official AppImage/`.deb`/`.rpm`, or pair the radio on the host with `bluetoothctl` and retry.
- If the Bluetooth adapter isn't detected, check: `systemctl status bluetooth` and `rfkill list`.
- If device pairing fails with `pairing_required` / connection attempt failed, try **"Remove & Re-pair Device"** in the app, or manually remove via `bluetoothctl`:
  ```bash
  bluetoothctl
  # Inside bluetoothctl:
  remove XX:XX:XX:XX:XX:XX # Replace with your device MAC
  # Then re-pair from the app
  ```
- For **Meshtastic** devices, the first pairing attempt may use PIN `123456`. For **MeshCore**, always use the PIN shown on the radio.
- If devices won't pair or connect, power-cycle Bluetooth:
  ```bash
  bluetoothctl power off
  bluetoothctl power on
  ```
- MeshCore devices must be in Bluetooth Companion mode. If you still see bonds without a PIN, remove the device in `bluetoothctl` or use **Remove & Re-pair Device**, then connect again.

### BLE auto-reconnect: "No previously connected BLE device found"

**Cause**: The reconnect card appeared, but no remembered BLE peripheral id was available (for example after Forget device).

**Fix**: Click **Forget this device** if shown, then **Connect** and select the radio again.

### Dual-radio BLE startup / wake stagger

When both Meshtastic and MeshCore have **different** saved BLE peripherals, concurrent sidecar GATT sessions are allowed. Startup and wake still **stagger** auto-connect so both stacks do not contend on the adapter at once:

- Coordinator: `meshcoreDualNobleBleInit.ts` (historical name); wired from **`App.tsx` `useLayoutEffect`**.
- **Primary** is chosen from `mesh-client:protocol` localStorage (`meshcore` / `meshtastic`; Reticulum or missing → Meshtastic).
- **Secondary** waits for primary GATT + handshake settle (or first attempt failure) — not full device configure.
- Active scans may return `scan_busy` while another owner holds the scan mutex.

See also wake recovery under [Sleep, wake, and long-running sessions](#sleep-wake-and-long-running-sessions) (Meshtastic-first stagger). For Reticulum scan contention, see [Reticulum BLE RNode blocks Meshtastic/MeshCore BLE](troubleshooting-reticulum.md#reticulum-ble-rnode-blocks-meshtasticmeshcore-ble).

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

### Connection panel Link quality (TCP) shows "—" or unexpected latency

**Cause:** For **Meshtastic WiFi/TCP** and **MeshCore TCP/IP OpenHop**, the Connection panel signal bars reflect **live-session responsiveness** — an EWMA of write→first-data delay on the already-open TCP socket — not a separate connect probe. Bars may show **"—"** until traffic has produced a sample, or after ~2 minutes without a completed sample (covers idle heartbeat gaps). Meshtastic **WiFi/HTTP** still uses a `/json/report` RTT probe (separate from the TCP session). **Reticulum** hub rows use a short-lived TCP connect probe while the sidecar is **starting**, and a short **seed burst after ready** only when no finite RTT sample exists yet (shared across Interfaces / stack panels). Continuous probes stop once seeded so a second raw connect cannot keep colliding with the sidecar link.

**Why not a second TCP connect?** Probing the same `host:port` as the live session every few seconds can RST ESP32/lwIP-class devices (see PR discussion around competing connections).

**Fix:** Exercise the link (chat, NodeDB traffic, companion RPCs). If bars stay empty while the session is healthy, that is expected during idle gaps; reconnect if the session itself drops.

### Meshtastic HTTP fails immediately with "Invalid host format"

**Cause:** Builds before v5.21.x validated the hostname incorrectly when the address included a port (`192.168.1.10:443`), rejecting every HTTP connect.

**Fix:** Upgrade to v5.21.2 or later. As a workaround on older builds, omit the port when the app default applies.

Local/private targets include RFC1918 IPv4 (`10.x`, `172.16–31.x`, `192.168.x`), RFC4193 ULA (`fd00::/8`), link-local IPv6 (`fe80::/10`), loopback, and `.local` mDNS names.

## Sleep, wake, and long-running sessions

### macOS sleep / wake and auto-reconnect

After the lid closes or the Mac sleeps, mesh-client pauses reconnect backoff and MQTT I/O until the OS resumes. Recovery is **Meshtastic-first**: expect roughly **4 seconds** after wake before Meshtastic RF auto-reconnect runs, then MeshCore about **8 seconds** later. When both protocols use BLE, MeshCore's auto-reconnect additionally waits (up to **30 seconds**) for the Meshtastic BLE link's GATT connection + protocol handshake to settle — not for full device configure — before it starts its own connect.

- **Sidecar GATT BLE:** The client tries an immediate connect (remembered peripheral) before scanning up to **30 seconds** for a new advertisement. LoRa BLE uses `ensureForBle()` so the sidecar is up without a Reticulum UI Start.
- **Stuck “reconnecting” banner:** During sleep the UI may show disconnected with connection loss until wake recovery runs. If reconnect never progresses after wake, use **Disconnect & Quit** from the Connection tab or quit the app and reconnect manually.
- **Dual-protocol BLE (Meshtastic + MeshCore):** Auto-reconnect is already staggered Meshtastic-first (see above); manually forcing MeshCore to reconnect before Meshtastic is not necessary and does not match the recovery order. If both protocols are still down after ~30 seconds, use **Connect** on each tab in the same Meshtastic-then-MeshCore order. Concurrent scans from both tabs can return `scan_busy`.
- **BLE stack stuck after wake** (`connect_timeout`, `adapter_missing`, or peripheral not found in the app log): **Quit mesh-client fully** (Cmd+Q), toggle **Bluetooth off → on** in System Settings (or power-cycle the radios), reopen the app, wait ~5 seconds, then use **Connect** on the Connection tab.
- **MQTT-only:** Transient errors such as `ENETDOWN` or `ENETUNREACH` after wake should recover automatically.
- **Renderer hung after wake:** If the log shows `[main] System resumed` followed by `[main] renderer unresponsive after system resume (no heartbeat within 30s)` and **no** `[usePowerRecovery]` lines, the renderer event loop was already dead before wake recovery ran. **Quit mesh-client fully** and relaunch — do not rely on Disconnect alone.

### Windows sleep / wake and auto-reconnect

After sleep or hibernate, mesh-client uses the same resume path as macOS: reconnect backoff and MQTT I/O pause until the OS resumes. Recovery is **Meshtastic-first**: expect roughly **4 seconds** after wake before Meshtastic RF auto-reconnect runs, then MeshCore about **8 seconds** later. When both protocols use BLE, MeshCore's auto-reconnect additionally waits (up to **30 seconds**) for the Meshtastic BLE link's GATT connection + protocol handshake to settle — not for full device configure — before it starts its own connect.

- **Sidecar GATT BLE:** Same immediate-connect-then-scan behavior as macOS (remembered peripheral, then up to **30 seconds** scanning for a new advertisement).
- **Stuck “reconnecting” banner:** During sleep the UI may show disconnected with connection loss until wake recovery runs. If reconnect never progresses after wake, use **Disconnect & Quit** from the Connection tab or exit the app fully and reconnect manually.
- **Dual-protocol BLE (Meshtastic + MeshCore):** Auto-reconnect is already staggered Meshtastic-first (see above); manually forcing MeshCore to reconnect before Meshtastic is not necessary and does not match the recovery order. If both protocols are still down after ~30 seconds, use **Connect** on each tab in the same Meshtastic-then-MeshCore order. Concurrent scans from both tabs can return `scan_busy`.
- **MeshCore pairing after wake:** If BLE appears connected but the MeshCore handshake or GATT notify never completes, use **Remove & Re-pair Device** on the Connection tab so the app unpairs and pairs the radio again (MeshCore requires a bond on Windows; the app does the pairing itself).
- **BLE stuck after wake** (`connect_timeout`, peripheral not found, or GATT session errors in the app log): **Exit mesh-client fully**, toggle **Bluetooth off → on** in **Settings → Bluetooth & devices** (or disable/enable the adapter in **Device Manager**), wait a few seconds, reopen the app, then use **Connect**. If disconnects persist, update the Bluetooth driver in Device Manager.
- **MQTT-only:** Transient errors such as `ENETDOWN` or `ENETUNREACH` after wake should recover automatically.
- **Renderer hung after wake:** Same as macOS — if you see `[main] renderer unresponsive after system resume (no heartbeat within 30s)` without `[usePowerRecovery]` logs, quit fully and relaunch.

**Linux:** Same sidecar GATT path as macOS/Windows; see **Linux-specific** under [BLE known issues](#ble-known-issues) for BlueZ / Flatpak steps.

**Reticulum (all platforms):** On suspend, `onPowerSuspend` clears in-memory rnsh sessions and rncp transfers. On resume, `onPowerResume` restarts the sidecar via `connect()` unless the user disconnected.

### Long-running sessions (multi-day uptime)

If mesh-client stays open for **days** on a busy mesh (especially **MeshCore BLE-only** with hundreds of repeaters):

- Prefer **Serial/TCP** for always-on desks when practical.
- **MeshCore:** default contact cap is **10,000** (App settings); enable **auto-prune by age** if you want SQLite trimmed below that. Avoid bulk repeater status/neighbors refresh when not needed — thousands of `syncNextMessage timed out` lines in the log usually mean the companion radio is overloaded.
- **Meshtastic:** default node cap is **10,000**; enable **auto-prune** in App settings as needed.
- **Reticulum:** restart the sidecar/stack periodically on always-on nodes; message retention prunes run at startup and every 6 hours while the app is open.
- If the app crashes, save **`~/Library/Logs/DiagnosticReports/Mesh-client-*.ips`** (macOS) before relaunching; include the `.ips` and exported log when reporting.
- **Reporting a crash or lockup:** Prefer **Export for Developer / GitHub before restart** if the UI still responds. After a forced restart, export anyway — startup preserves the previous session log as `mesh-client.log.1` (also included in support bundles). Note app version, OS, uptime (`[main] long-session health` / snapshot `mainLiveness`), whether MeshCore BLE was connected, and any `[main] renderer heartbeat stalled` / `webContents unresponsive` lines.

After **24 hours** of uptime, the main process logs periodic **long-session health** lines (`[main] long-session health …`) with memory and per-session BLE timer state. While the window and renderer document are visible, missing renderer heartbeats for ~90s also log `[main] renderer heartbeat stalled`. Heartbeats intentionally pause for hidden documents, including windows fully covered by another window on macOS; the renderer reports that pause to the watchdog. Refocusing the app rearms detection. A heartbeat warning alone does not establish a renderer hang or a system-wide freeze.

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

**Cause**: Wireless interference, broker downtime, token issues (device-signing brokers: LetsMesh / MeshMapper / Colorado Mesh / Waev / Meshat.se / MeshCore.CA / EastMesh), or normal reconnect backoff after a failed attempt.

**Fix**:

- Check your WiFi/signal strength
- Verify the broker is online
- Expect **exponential reconnect backoff** (60s base, capped at 45 minutes per `src/shared/mqttReconnectSchedule.ts`); connack timeouts retry faster (~250ms)
- For device-signing brokers (LetsMesh / MeshMapper / Colorado Mesh / Waev / Meshat.se / MeshCore.CA / EastMesh): mesh-client refreshes the JWT automatically when MeshCore identity is already cached (including after a successful MeshCore radio session). If you never imported identity and have not connected a MeshCore radio yet, import under **Radio** or use **Custom** credentials; if refresh still fails, try re-importing MeshCore config JSON to replace a corrupt cache
- Enable debug logs to see the disconnect reason

### MQTT connected but no messages from other nodes

**Cause**: LetsMesh and Colorado Mesh are publish-only brokers; you can send packets to the mesh but won't receive other users' traffic over MQTT. The connection is real, but incoming messages are limited.

**Fix**: Expected behavior for public brokers. For two-way MQTT, use a different broker or connect via BLE/Serial.

### "Token expired" on a device-signing broker

**Cause**: JWT tokens expire after 1 hour (LetsMesh / MeshMapper / Colorado Mesh / Waev / Meshat.se / MeshCore.CA / EastMesh). The JWT `aud` always matches the broker hostname you connect to.

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

Battery, voltage, or uptime for your own node looks wrong or never updates? See [Meshtastic: mesh vs local client telemetry](meshtastic-telemetry-local-client.md).

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

MeshCore-specific problems moved to [MeshCore troubleshooting](troubleshooting-meshcore.md):

- [MeshCore TCP connect stuck or reconnect loop on OpenHop](troubleshooting-meshcore.md#meshcore-tcp-connect-stuck-or-reconnect-loop-on-openhop)
- [MeshCore TCP / pyMC: initial connect MsgWaiting drain slow or paused](troubleshooting-meshcore.md#meshcore-tcp--pymc-initial-connect-msgwaiting-drain-slow-or-paused)
- [MeshCore contact delete and sticky Rooms badge](troubleshooting-meshcore.md#meshcore-contact-delete-and-sticky-rooms-badge)
- [MeshCore contact age prune and favorites](troubleshooting-meshcore.md#meshcore-contact-age-prune-and-favorites)
- [MeshCore: UI slow or frozen with large repeater lists (USB serial)](troubleshooting-meshcore.md#meshcore-ui-slow-or-frozen-with-large-repeater-lists-usb-serial)
- [MeshCore reply misquote / duplicate chat messages](troubleshooting-meshcore.md#meshcore-reply-misquote--duplicate-chat-messages)
- [MeshCore: "Get Telemetry" returns timeout](troubleshooting-meshcore.md#meshcore-get-telemetry-returns-timeout)
- [MeshCore: "Get Neighbors" button not visible](troubleshooting-meshcore.md#meshcore-get-neighbors-button-not-visible)
- [MeshCore: Status / Sensors / Neighbors toast when disconnected](troubleshooting-meshcore.md#meshcore-status--sensors--neighbors-toast-when-disconnected)
- [MeshCore: Cannot connect via Bluetooth, USB, or HTTP](troubleshooting-meshcore.md#meshcore-cannot-connect-via-bluetooth-usb-or-http)
- [MeshCore: Room server login, posts, and Windows 10](troubleshooting-meshcore.md#meshcore-room-server-login-posts-and-windows-10)
- [MeshCore: Trace Route or Ping trace times out](troubleshooting-meshcore.md#meshcore-trace-route-or-ping-trace-times-out)

## Reticulum

Reticulum-specific problems moved to [Reticulum troubleshooting](troubleshooting-reticulum.md):

- [RRC connect stuck / Cancel](troubleshooting-reticulum.md#rrc-connect-stuck--cancel)
- [RRC hub dropped vs Disconnect](troubleshooting-reticulum.md#rrc-hub-dropped-vs-disconnect)
- [RRC false self-PART / hubParted banner](troubleshooting-reticulum.md#rrc-false-self-part--hubparted-banner)
- [RRC history shows fewer messages than Retention](troubleshooting-reticulum.md#rrc-history-shows-fewer-messages-than-retention)
- [Reticulum sidecar won't start or health poll times out](troubleshooting-reticulum.md#reticulum-sidecar-wont-start-or-health-poll-times-out)
- [Reticulum RRC/LXMF requires live rns-stack right after start](troubleshooting-reticulum.md#reticulum-rrclxmf-requires-live-rns-stack-right-after-start)
- [Reticulum Cancel then Connect stuck on START_ABORTED](troubleshooting-reticulum.md#reticulum-cancel-then-connect-stuck-on-start_aborted)
- [Reticulum sidecar cargo build fails (`register_packet_tap` / `RETICULUM_CARGO_BUILD_FAILED`)](troubleshooting-reticulum.md#reticulum-sidecar-cargo-build-fails-register_packet_tap--reticulum_cargo_build_failed)
- [Reticulum AutoInterface log spam on macOS (VPN utun / ENOBUFS)](troubleshooting-reticulum.md#reticulum-autointerface-log-spam-on-macos-vpn-utun--enobufs)
- [Reticulum local DMs hang with AutoInterface + private TCP hub](troubleshooting-reticulum.md#reticulum-local-dms-hang-with-autointerface--private-tcp-hub)
- [Reticulum public hub TCP blocked (fast-flapping client)](troubleshooting-reticulum.md#reticulum-public-hub-tcp-blocked-fast-flapping-client)
- [Reticulum DM shows "Stored at propagation node" but the reply never arrives (PN island / preferred mismatch)](troubleshooting-reticulum.md#reticulum-dm-shows-stored-at-propagation-node-but-the-reply-never-arrives-pn-island--preferred-mismatch)
- [Reticulum Nomad Network or topology API returns 404](troubleshooting-reticulum.md#reticulum-nomad-network-or-topology-api-returns-404)
- [Nomad My Pages hosting enabled but not serving](troubleshooting-reticulum.md#nomad-my-pages-hosting-enabled-but-not-serving)
- [Nomad page that used to show my name is now generic (or "not allowed")](troubleshooting-reticulum.md#nomad-page-that-used-to-show-my-name-is-now-generic-or-not-allowed)
- [Nomad Network pages hang or almost never load](troubleshooting-reticulum.md#nomad-network-pages-hang-or-almost-never-load)
- [Reticulum sidecar stops during dev (Vite HMR)](troubleshooting-reticulum.md#reticulum-sidecar-stops-during-dev-vite-hmr)
- [Reticulum `proxyGet` fetch failed / many `[ReticulumIPC] start` lines](troubleshooting-reticulum.md#reticulum-proxyget-fetch-failed--many-reticulumipc-start-lines)
- [Reticulum announce interval resets after saving stack settings](troubleshooting-reticulum.md#reticulum-announce-interval-resets-after-saving-stack-settings)
- [Clear announces does not empty the Peers tab under rns-stack](troubleshooting-reticulum.md#clear-announces-does-not-empty-the-peers-tab-under-rns-stack)
- [Reticulum identity hash mismatch (stub vs live stack)](troubleshooting-reticulum.md#reticulum-identity-hash-mismatch-stub-vs-live-stack)
- [Reticulum `.rsi` / raw identity backup restore fails](troubleshooting-reticulum.md#reticulum-rsi--raw-identity-backup-restore-fails)
- [Reticulum Map empty or no markers](troubleshooting-reticulum.md#reticulum-map-empty-or-no-markers)
- [Reticulum BLE RNode blocks Meshtastic/MeshCore BLE](troubleshooting-reticulum.md#reticulum-ble-rnode-blocks-meshtasticmeshcore-ble)
- [Reticulum BLE RNode pairing fails (wrong PIN / no PIN on display / not in macOS list)](troubleshooting-reticulum.md#reticulum-ble-rnode-pairing-fails-wrong-pin--no-pin-on-display--not-in-macos-list)
- [Reticulum BLE RNode bond is stale (OS still shows Paired)](troubleshooting-reticulum.md#reticulum-ble-rnode-bond-is-stale-os-still-shows-paired)
- [Reticulum LXMF duplicate Sending / orphaned pending rows](troubleshooting-reticulum.md#reticulum-lxmf-duplicate-sending--orphaned-pending-rows)
- [Reticulum remote propagation sync fails or never completes](troubleshooting-reticulum.md#reticulum-remote-propagation-sync-fails-or-never-completes)
- [Reticulum local PN hosting not discoverable](troubleshooting-reticulum.md#reticulum-local-pn-hosting-not-discoverable)
- [Reticulum: Stored at PN but Sync leaves Chat empty](troubleshooting-reticulum.md#reticulum-stored-at-pn-but-sync-leaves-chat-empty)
- [Reticulum PN hosting policy apply fails](troubleshooting-reticulum.md#reticulum-pn-hosting-policy-apply-fails)
- [Reticulum last synced time looks wrong after update](troubleshooting-reticulum.md#reticulum-last-synced-time-looks-wrong-after-update)
- [MeshCore Colorado Mesh / LetsMesh won't connect after upgrade](troubleshooting-reticulum.md#meshcore-colorado-mesh--letsmesh-wont-connect-after-upgrade)
- [MeshCore Colorado Mesh one-time region prompt](troubleshooting-reticulum.md#meshcore-colorado-mesh-one-time-region-prompt)
- [Reticulum: announces / Nomad / RRC work but Chat fails both ways](troubleshooting-reticulum.md#reticulum-announces--nomad--rrc-work-but-chat-fails-both-ways)
- [Reticulum DM stuck on Sending (MeshChatX / shared instance)](troubleshooting-reticulum.md#reticulum-dm-stuck-on-sending-meshchatx--shared-instance)
- [Reticulum: no propagation node configured](troubleshooting-reticulum.md#reticulum-no-propagation-node-configured)
- [Reticulum: Ratspeak DMs work but mesh-client stays silent](troubleshooting-reticulum.md#reticulum-ratspeak-dms-work-but-mesh-client-stays-silent)
- [Reticulum interface add/edit/delete fails](troubleshooting-reticulum.md#reticulum-interface-addeditdelete-fails)
- [Reticulum I2P interface stays down](troubleshooting-reticulum.md#reticulum-i2p-interface-stays-down)
- [Reticulum Peers stale or slow with many hubs or testnets](troubleshooting-reticulum.md#reticulum-peers-stale-or-slow-with-many-hubs-or-testnets)
- [RNode Wi-Fi interface offline or won't connect](troubleshooting-reticulum.md#rnode-wi-fi-interface-offline-or-wont-connect)
- [Reticulum Admin: RNode flasher timeout or stalled transfer](troubleshooting-reticulum.md#reticulum-admin-rnode-flasher-timeout-or-stalled-transfer)
- [Reticulum Remote transfer fails or `path_constrained`](troubleshooting-reticulum.md#reticulum-remote-transfer-fails-or-path_constrained)
- [Reticulum Remote inbound rncp blocked (Ask mode / policy)](troubleshooting-reticulum.md#reticulum-remote-inbound-rncp-blocked-ask-mode--policy)
- [Reticulum hung-sidecar watchdog restart](troubleshooting-reticulum.md#reticulum-hung-sidecar-watchdog-restart)
- [Reticulum LXMF paper create/ingest fails](troubleshooting-reticulum.md#reticulum-lxmf-paper-createingest-fails)
- [Reticulum Games challenge fails or board does not update](troubleshooting-reticulum.md#reticulum-games-challenge-fails-or-board-does-not-update)
- [Reticulum LXST voice call fails or is silent](troubleshooting-reticulum.md#reticulum-lxst-voice-call-fails-or-is-silent)

## TAK (CoT gateway)

The **TAK** tab runs a local CoT server and a remote relay to an OpenTAKServer, FreeTAKServer, or TAK Server. The relay uses TLS or plain TCP; plain TCP is unencrypted and is not saved for launch auto-connect. TAK Servers that use logins issue a client certificate from a username and password on the enrollment port (usually 8446). Inbound CoT from local clients and the remote server shows as contacts on the map. The status bar uses one TAK label that combines the local server and the remote relay (for example, "TAK running, remote connected").

### EUD reports “TLS certificate invalid” / cannot connect with a mesh-client data package

**Cause**: The data package’s `connection.pref` dials your LAN IP over TLS. Older mesh-client builds issued a server certificate with only CN=`serverName` (e.g. `mesh-client`) and no Subject Alternative Name, so strict EUDs (iTAK, WinTAK, newer ATAK) reject the certificate.

**Fix**:

1. Update mesh-client (server certs now include DNS + LAN IP in SAN).
2. On the **TAK** tab, start the local server (or **Regenerate Certificates** if it was already running on an older build).
3. **Generate data package** again and import the new zip on the EUD (remove any previous mesh-client connection/package first).
4. If your LAN IP changed since the last package, generate a new package and re-import — the connect string and cert SAN must match.

Also confirm the phone/tablet is on the same LAN as the desktop, the TAK server is running, and the firewall allows inbound TCP on the configured port (default 8089).

### ATAK reports “remote host's certificate not trusted; check truststore” with a mesh-client data package

**Cause**: Older mesh-client builds shipped the CA in the data package as a PEM file (`certs/ca.pem`). ATAK loads the truststore as a password-protected PKCS#12 file, so the PEM fails to load and the server certificate is rejected.

**Fix**:

1. Update mesh-client (the package now contains `certs/truststore.p12`).
2. **Generate data package** again and import the new zip on the EUD (remove any previous mesh-client connection/package first).

On an older build, convert the CA by hand and import it in ATAK under **Settings → Network Preferences → TAK Servers → Mesh Client → Import Trust Store** (password `atakatak`):

```bash
openssl pkcs12 -export -nokeys -in ca.pem -out truststore.p12 -caname mesh-client-ca \
  -passout pass:atakatak -certpbe PBE-SHA1-3DES -macalg sha1
```

## Chat, nodes, and notifications

### Unread messages but no app-icon badge

On **macOS**, allow notifications for Mesh Client and enable **Badge application icon** in **System Settings → Notifications → Mesh Client**. The app initializes macOS notification authorization when unread messages exist and reapplies the current badge when its window regains focus. Reading the remaining unread messages clears the badge. macOS notification settings still control whether the badge is visible; the app does not override a denied permission.

On **Windows**, unread messages use a red taskbar overlay. On **Linux**, launcher counts depend on desktop support for the LauncherEntry D-Bus API. Tray indicators remain separate from the app-icon badge.

### Meshtastic: inbound messages on the wrong channel tab

**Symptoms**

- Public mesh traffic appears under your **primary/private** Chat channel pill instead of the configured public slot (often channel 1).
- The same message may appear on two channel tabs when heard over **RF** (correct slot) and **MQTT** (wrong slot).
- Other Meshtastic clients (phone app, radio UI) show the message on the expected channel.

**Cause**

MQTT ingest must map inbound text to the **receiver's** local channel slot using the MQTT topic channel name (`LongFast`, regional names, etc.) via `channelNameToIndex`. `MeshPacket.channel` in the ServiceEnvelope is the **sender's** local RF slot and must not drive attribution — remote gateways often use a different slot layout (e.g. LongFast on slot 1 while you use slot 0).

Mis-filed messages also occur when `channelNameToIndex` is stale or incomplete: unnamed default-public on slot 1 without radio sync, MQTT-only without `ChannelName@index=` manual PSK lines, MQTT connecting before RF channel configs arrive (cold-start empty map), or (fixed in current builds) a mid-stream radio sync that temporarily wiped `LongFast` while channel packets arrived one-by-one after cycling radios — topic→index and radio PSKs are now merge-safe so a partial `OnTrail=0` push cannot drop `LongFast=1` or private decrypt keys, and `radioSessionId` clears prior radio maps when the RF identity changes.

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
- Badge counts disagree between the rail and Chat channel pills after upgrade or protocol switch.
- **Copy Debug Snapshot** shows messages on `ch:1` (or higher) while the radio only has channel 0 configured.

**Cause**

Stale `mesh-client:lastRead:<protocol>` watermarks (including legacy merged keys) or DB messages on channel indices the radio no longer uses. MeshCore unread badges intentionally ignore zero-PSK slots; poisoned last-read values can still inflate counts until sanitized.

**Fix**

1. Open **Chat**, visit each configured channel once (marks last-read), or use **App → Data Management → Copy Debug Snapshot** to confirm channel indices vs runtime channels.
2. If counts persist after visiting channels, clear last-read for the protocol in browser devtools (`localStorage.removeItem('mesh-client:lastRead:meshcore')` or `meshtastic`) and reload — you will lose per-channel read state.
3. For stuck rail totals with live traffic in logs, see [Chat stuck](#chat-stuck-new-traffic-in-logsdb-but-messages-do-not-appear) and attach a debug snapshot when filing an issue.

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

- While on **Connection**, **Nodes**, or **Log**, rail unread badges update for new traffic.
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

The companion radio queues public messages behind a **single serialized USB serial lane** shared with repeater admin, init RPCs, and MsgWaiting drains. Auto-drain tries bulk `getWaitingMessages` first (shorter silent timeout on serial); on timeout it falls back to `syncNextMessage` without tearing down the link.

**In-app status**

The **header status indicator** (queued backlog and active sync on any protocol tab; **paused/deferred** state only on the MeshCore tab) shows silent auto-drain (**X / Y** on bulk success, **Fetched N…** on fallback) or deferred drain behind admin/trace work. On serial, messages may still arrive in small batches without a Chat/Rooms panel banner.

**Fix / workaround**

1. Pause repeater **Status / Neighbors / ping** while monitoring live chat on serial.
2. Prefer **BLE** or **TCP** (including OpenHop) when available for lower-latency chat.
3. If drains stall, **Disconnect → Connect** or quit and reopen after repeated timeouts in the log.
4. Use **Sync now** from the **header waiting-messages indicator** for a large backlog (determinate **X / Y** progress in the header tooltip/status). Auto-drain now also shows progress when bulk succeeds.

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

**Chat desktop notifications** appear for Meshtastic, MeshCore, Reticulum LXMF Chat and RRC, but only while the app window is inactive. They are visual-only (`silent: true`) and follow the same mutes as the sound. Typed sounds come from the app’s Web Audio path. The main process session permission handlers must allow `notifications`; otherwise the renderer's `Notification.permission` reads `denied` and nothing is shown (the log prints `[permissions] checkHandler: notifications → denied`). If the log shows `granted` and still nothing appears, check that the OS allows notifications for Mesh-Client.

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

### Graph or Topology does not show all nodes

**Symptoms**: MeshCore/Meshtastic **Graph** or Reticulum **Topology** says it is showing 400 of N nodes even with **Show distant peers** ticked and **Max hops** set to **All hops**.

**Cause**: The force-directed layout has a hard visible-node budget of **400** after hop filters. Numeric **Max hops** is not gated by Show distant. Unknown hops are omitted unless Max hops is **All hops** and Show distant is on. The nearby hop ceiling applies only when Max hops is **All hops**. Leftover nodes beyond the layout budget are omitted on purpose. Reticulum Topology also ingests at most 800 path-table rows after hop filters (sidecar 2,000).

**Fix**: This is expected. The toolbar note states the 400-node limit. Turn on **Show distant peers** and set **Max hops** to **All hops** to include multi-hop peers up to 400. On Topology, use **RF only** to drop TCP/I2P hubs if you only want RNode/KISS/BLE. Narrow **Max hops** if the graph is too dense.

### No signal bars on some nodes

**Cause**: Signal strength is only available for **direct (0-hop) RF** neighbors. Multi-hop and MQTT-heard nodes have no client-side signal strength.

**Fix**: Not a bug; use SNR/last heard and routing diagnostics instead for those paths.

### Map tab without internet (offline / no WAN)

**Basemap tiles:** The map background uses **OpenStreetMap** by default (or **Carto Dark** if selected). On the Map tab, use the **Layers** control under the **online/stale/offline** status counts (top right) to switch basemaps and toggle overlays (node markers, movement trails, waypoints, diagnostic halos). The `TileLayer` is defined in [`MapPanel.tsx`](https://github.com/Colorado-Mesh/mesh-client/blob/main/src/renderer/components/MapPanel.tsx). Tiles are served through the privileged **`mesh-tiles:`** protocol and stored under the app **userData** `tile-cache/` directory (viewed tiles cache automatically while online; ~1 GiB LRU). Use **Layers → Offline maps → Download current view** while online to pre-fetch a region (estimate + confirm; a single job is capped at about **half** the cache budget so downloaded tiles are not immediately evicted). Downloads pause if the link drops and resume after a stable connection (~60s). Optional **Auto-cache** downloads the current view after a short settle when the viewport key changes. On high-DPI displays, **Carto Dark** region downloads may fetch `@2x` tiles. **Clear tile cache** frees disk. **Without internet access, uncached areas look blank**; previously downloaded or viewed tiles still render. Overlays (markers, trails, polylines, halos) come from local/SQLite state and still work offline. Developer reference: [`docs/development/offline-maps.md`](development/offline-maps.md).

**Overlays:** **Node markers, polylines, position trails, and other vector layers** are separate from the tile layer. If nodes have latitude/longitude (from RF, MQTT, SQLite, or your session), those overlays can still **render on top of a missing or partial basemap**.

**Your position offline:** Use **device GPS** when available, **Fixed Position** on the **Radio** tab, or **static coordinates** in app/GPS settings. The IP-geolocation fallback returns immediately with code `OFFLINE` when there is no WAN. See **GPS "Location unavailable" or stuck on the map** above. Positions heard over the mesh do not require internet.

**USGS Topo blank offline:** **USGS Topo** covers the **United States only** — outside the US the basemap is blank by design. Tiles come from the fixed, allowlisted USGS National Map host (`basemap.nationalmap.gov`); if it is blocked by a firewall/proxy or down, uncached areas stay blank. Offline, only viewed or region-downloaded tiles render (select USGS Topo before **Download current view**). Above zoom 16 tiles are overzoomed and look soft. Custom tile URLs are rejected by design. See [offline-maps.md](development/offline-maps.md).

### Verifying offline behavior (manual QA)

With **Wi‑Fi off** or **airplane mode** on, using a **packaged** build if possible:

1. Confirm the app **window loads** and core tabs work; connect via **USB serial** or **BLE** to a local radio if you need RF features.
2. Open the **Map** tab: expect **blank basemap** where tiles were never cached; **markers and trails** may still appear when position data exists. Pre-downloaded regions should still show tiles.
3. The footer shows a muted **Updates paused (offline)** state (not orange **Update error**) when WAN is missing; update checks do not retry in a loop. If an update was already downloaded (**ready** / install prompt), that ready state is kept when going offline.

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

The app functions fully offline; this is not a critical error. When there is no WAN, the footer shows a muted **Updates paused (offline)** state and does not amber-nag or retry in a loop. If an update was already downloaded (**ready**), the footer keeps that ready/install state instead of switching to offline. When connectivity returns and stays stable (~60s), one quiet update check runs (including after a network-class failure while the browser still reports online). If a real (non-network) update error occurs, the footer shows **Update error**; use **Check for updates** in the app menu or retry from the footer when applicable. Update checks are rate-limited by the GitHub API and may silently skip when the limit is reached.

**Footer shows vX.Y.Z then Update error after Cut release:** The GitHub release may have been published with an `untagged-*` tag instead of `vX.Y.Z` (draft detach / leftover placeholder ref). On GitHub → Releases, confirm the latest release tag is `vX.Y.Z`. Repair with `GH_TOKEN=YOUR_ADMIN_PAT node scripts/repair-published-release-tag.mjs --tag vX.Y.Z`, or edit the release in the GitHub UI. CI prepare/finalize repair `tag_name` and delete orphan `untagged-*` refs; verify fails if any matching release is still untagged; a **Repair published release tag** workflow also runs on Publish.

### Language and translations

**How do I change the language?**

Click the **globe icon** in the header to select from the 16 supported languages. Your preference is saved across restarts.

**A translation is incorrect or missing.**

Translations are machine-generated using MyMemory and may contain errors. If you find a mistake, please open a [Translation Error issue](https://github.com/Colorado-Mesh/mesh-client/issues/new?assignees=&labels=translation&template=translation-error.md&title=Translation+Error) on GitHub with the correct text.

**Why are some strings still in English?**

The app falls back to English for any key that hasn't been translated into your selected language yet. Translations are bundled statically at build time; new translations will appear in the next app update.

## MECP (emergency reports)

**Where is the MECP received log?**

Inbound MECP messages are appended to a durable audit file under the app `userData` folder (not the rotating session `mesh-client.log`):

- macOS: `~/Library/Application Support/mesh-client/mecp-received.log` (rotated backup `mecp-received.log.1`)
- Windows: `%APPDATA%\mesh-client\mecp-received.log`
- Linux: `~/.config/mesh-client/mecp-received.log`

Use **App → MECP → Export MECP log**, or open a GitHub/Developer support bundle (includes the file when non-empty). Developer reference: [`docs/development/mecp.md`](development/mecp.md).

**MAYDAY/URGENT alerts ignore mute**

Default Web Audio tones (`chatNotifications.ts` profiles; overrideable in **App → Notifications**):

| Severity  | Event key    | Default sound                                             |
| --------- | ------------ | --------------------------------------------------------- |
| 0 MAYDAY  | `mecpSiren`  | Six sweeping siren cycles (~5.0 s; same length as URGENT) |
| 1 URGENT  | `mecpEas`    | US EAS-style 853+960 Hz attention tone, 5 seconds         |
| 2 SAFETY  | `mecpSafety` | Short–long (dit–dah) pairs × 6, 1175 Hz square (~4.4s)    |
| 3 ROUTINE | `mecp`       | Repeated ascending triple pulse                           |

MAYDAY and URGENT ignore mute and still fire while Chat is focused on that conversation. SAFETY and ROUTINE play when unmuted (also while focused). Drill codes (D01/D02) never alert. Configure Meshtastic↔MeshCore RF bridging under **App → MECP RF rebroadcast** (default off; optional bidirectional). See [notification-sounds.md](notification-sounds.md) and [`docs/development/mecp.md`](development/mecp.md).

**MECP button missing in Chat**

App → MECP → **Show MECP button in Chat** is off by default. Enable it to show MECP compose in Chat: a red siren icon button in the composer, left of Send. It is hidden in the **Starred** view, which has no composer. The **Incident** tab still receives inbound MECP without compose enabled.

**What is the Incident tab?**

**Incident** (pinned at the bottom of the rail, next to **App**) is the EMCOMM common operating picture — not a chat history. It lists **open** MECP emergencies only (resolved rows disappear; open MAYDAY and URGENT rows badge the tab, drills included; SAFETY and ROUTINE never badge). Each row shows:

- Severity (MAYDAY / URGENT / SAFETY / ROUTINE) and MECP codes
- Sender name, optional free text, ACK count, and which protocols heard the report
- **Beacon active** when a distress beacon is still running
- **Acknowledge** (R01) or **Confirm** (B02 for an active beacon) — best-effort on the mesh, not a read receipt
- **Resolve** to close the incident on this workstation only

Inbound MECP populates the list automatically (live + hydrate from chat history). Map → **Layers → Emergency incidents** plots open rows that have coordinates. Empty is normal until someone sends MECP. Enabling Chat compose under App → MECP only shows the compose control so you can send one — it does not populate the Incident list by itself. See the README **EMCOMM / Incident Command** section and [`docs/development/emcomm.md`](development/emcomm.md).

**MAYDAY stuck / “will send when connected”**

Emergency MECP uses the durable outbox (`priority: emergency`). It keeps retrying until the network acknowledges the report (no 24h age stop, no attempt limit). Check Chat for the emergency OutboxBubble ("Waiting for network acknowledgement…" or a retry countdown); **Stop retrying** requires confirm. See [`docs/development/emcomm.md`](development/emcomm.md).

**Incident tab empty after restart**

Incidents persist across restarts in local storage (`mesh-client:incidents`), and on startup the MECP watcher also upserts any MECP still in the hydrated chat history — without re-alerting. The tab can still be empty on a cold start when: local storage was cleared (or this is a fresh install / new profile), the incident was **Resolved** (only open/acked rows are listed), or the original message aged out of chat history before the store saw it. The badge counts open MAYDAY and URGENT rows, including drills (SAFETY and ROUTINE are listed but not counted). The durable record is always `mecp-received.log` (above).

**Watched node silence / battery / link-down alerts**

Ops alerts use App settings (`nodeSilenceAlertMinutes`, `nodeBatteryLowThreshold`, `notifyOnLinkDown`) and **watched** nodes only — watch a node from node detail first. Silence escalation fires at **2×** the silence threshold (the first offline notice comes from the normal watch notifier); with no silence minutes set, escalation is off. Battery low needs battery telemetry (ignored when the node reports 0 or >100 % / charging) and re-arms after recovering 5 points above the threshold. Link-down waits ~5 s, never fires on manual disconnect or while RF reconnect is in progress, and fires once reconnect gives up. Reticulum has no battery telemetry or link-down alert.
