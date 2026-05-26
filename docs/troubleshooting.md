# Troubleshooting

Setup (clone, prerequisites, Flatpak build steps) is in [development-environment.md](development-environment.md). This page covers runtime failures, connections, and packaged installs.

### `pnpm install` fails on native module compilation

See [development-environment.md](development-environment.md) for OS-specific prerequisite installation.

### Windows: "Could not find any Visual Studio installation to use"

See [development-environment.md](development-environment.md#windows) for required build tools and the full recovery steps.

### Windows: "Could not find any Python installation to use" (e.g. when building `@serialport/bindings-cpp`)

See [development-environment.md](development-environment.md#windows) for Python setup and npm/node-gyp troubleshooting.

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

### macOS: File is damaged and cannot be opened

**Cause:** macOS tags downloads with the **`com.apple.quarantine`** extended attribute. For apps that are **not signed with a Developer ID** and **not notarized**, Gatekeeper may show **"File is damaged and cannot be opened"** (or **"Mesh-client" is damaged and can't be opened**) instead of the usual unidentified-developer prompt. This is a **security / quarantine** behavior and is **common on Apple silicon** for community-built Electron binaries.

**Fix:**

1. Open **System Settings → Privacy & Security** and scroll to the bottom. If you see "Mesh-client was blocked from use", click **Allow** to run the app.
2. If you don't see the Mesh-client entry in Privacy & Security, or the app still won't open after clicking Allow, strip the quarantine attribute; adjust the path if the app is still under **Downloads** or another folder:

```bash
xattr -r -d com.apple.quarantine /Applications/Mesh-client.app
```

After running xattr, check Privacy & Security again (scroll to the bottom); the entry should now appear with an **Allow** button.

**Right-click → Open** on first launch can also help in some cases. Background and discussion: [jeffvli/feishin#104 (comment)](https://github.com/jeffvli/feishin/issues/104#issuecomment-1553914730).

### App crashes on launch (macOS distributable)

- **macOS 26 (Tahoe) + EXC_BREAKPOINT at launch**: electron-builder ad-hoc signing can crash during ElectronMain/V8 init before any app code runs. This repo sets `mac.identity: null` in `electron-builder.yml` so the packaged app is unsigned and avoids that re-sign path; first open may require **Right-click → Open** or clearing quarantine ([macOS: File is damaged…](#macos-file-is-damaged-and-cannot-be-opened) above). For notarized releases, set a real Developer ID in `mac.identity` and retest on macOS 26. See [electron#49522](https://github.com/electron/electron/issues/49522) and [electron-builder#9396](https://github.com/electron-userland/electron-builder/issues/9396).
- This may also be a native module signing issue; try rebuilding: `pnpm run dist:mac`
- If building from source: make sure `pnpm install` completed without errors

### App shows "disconnected" but device is still on

- The Bluetooth connection can drop silently; click Disconnect, then Connect again
- For serial: the USB cable may have been bumped; reconnect

### Connection or transport issues: use Log **Analyze**

Open the **Log** panel (right rail), enable **debug** if needed, reproduce the problem, then click **Analyze**. The app scans recent buffered log lines for patterns (BLE, serial, TCP, MQTT, handshake timeouts, etc.) and lists **suggested next steps**. This complements export/delete: use it before filing an issue so you have concrete log context. Analysis is **heuristic**; treat recommendations as hints, not guarantees.

### Permission messages in the console

`[permissions] checkHandler: media → denied` and `web-app-installation → denied` are expected. The app only uses **serial** and **geolocation**; media and web-app-installation are intentionally denied.

### `pnpm run dist:mac` fails with `GH_TOKEN` / "Cannot cleanup"

electron-builder publishes to GitHub when it thinks it's in CI. Local builds use `--publish never` so artifacts land in `release/` without a token. Tag releases use `pnpm run dist:mac:publish` (and `:linux:publish` / `:win:publish`) with `GH_TOKEN` set; see `.github/workflows/release.yaml`.

### `[DEP0190]` when running electron-builder

Node deprecates `spawn(..., { shell: true })` with an args array. This project carries the packaging workaround via pnpm `patchedDependencies` on transitive packages used by the Electron build path. Re-run `pnpm install` if you upgrade `electron-builder` or its transitive packaging deps and the warning returns.

### `duplicate dependency references` during dist

npm's JSON tree lists hoisted packages with many duplicate refs (one per edge). That's expected and not something you need to fix. The patched packaging dependency path keeps that summary at **debug** only so normal `dist:*` runs stay quiet. To see it: `DEBUG=electron-builder pnpm dlx electron-builder --mac` (or your usual dist command).

### Linux packaged app: `Cannot find module 'readable-stream'`

**Symptom**: On Linux, the installed or AppImage build shows a main-process error when loading MQTT (`bl` → `mqtt-packet` → `mqtt` require stack).

**Cause**: pnpm 10.29.3+ marks some `pnpm list --json` nodes as deduped; electron-builder can omit those transitive packages from `app.asar` unless a full copy exists at a predictable path. `mqtt` is loaded from `node_modules` at runtime (not bundled into the main esbuild output).

**Fix in this repo**: `readable-stream@^4.7.0` is a **direct** production dependency (with the existing `patches/readable-stream@4.7.0.patch` for Windows `process/` resolution). Do not remove it when bumping `mqtt` or pnpm. After `pnpm run dist:linux`, verify the asar contains `node_modules/readable-stream`, `node_modules/bl`, and `node_modules/mqtt`. See [electron-builder#9603](https://github.com/electron-userland/electron-builder/issues/9603) and [pnpm#10601](https://github.com/pnpm/pnpm/issues/10601).

### `[DEP0169]` / `url.parse()` deprecation warning

The app uses npm package overrides to force `follow-redirects` and `cacheable-request` onto versions that use the WHATWG URL API, which removes this warning. To trace the source of any deprecation, run:

```bash
pnpm run trace-deprecation
```

### "A native module failed to load" dialog on startup

**Cause**: `@stoprocent/noble` (or `@serialport/bindings-cpp`) was compiled for a different Electron ABI; common after an Electron or Node version change.

**Fix**: Run `pnpm install` (the postinstall script rebuilds native modules for the correct ABI automatically).

- If you still see dlopen errors after switching machines or OSes, delete `node_modules` and run a clean `pnpm install`.
- **Windows**: Also ensure the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) is installed.

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
5. **Packaged app (`dist:win`)**: the build embeds a Windows application manifest with **`longPathAware`** so the installed **Mesh-client.exe** can use long paths when the machine has long paths enabled (registry / policy). That helps **runtime** paths inside the app; it does **not** shorten **`node_modules`** during **`pnpm install`** on the build machine—CI and developers still benefit from short clone paths for native rebuilds.

### Database directory is not writable

**Error**: `"Database directory is not writable: <path>"`

**Cause**: File permissions on the app's `userData` directory are too restrictive.

**Fix**:

- **Mac/Linux**: `chmod 755 ~/Library/Application\ Support/mesh-client` (or `~/.config/mesh-client` on Linux)
- **Windows**: Right-click `%APPDATA%\mesh-client` → Properties → Security → grant your user Full Control

### Language and Translations

**How do I change the language?**

Click the **globe icon** in the header to select from the 16 supported languages. Your preference is saved across restarts.

**A translation is incorrect or missing.**

Translations are machine-generated using MyMemory and may contain errors. If you find a mistake, please open a [Translation Error issue](https://github.com/Colorado-Mesh/mesh-client/issues/new?assignees=&labels=translation&template=translation-error.md&title=Translation+Error) on GitHub with the correct text.

**Why are some strings still in English?**

The app falls back to English for any key that hasn't been translated into your selected language yet. Translations are bundled statically at build time; new translations will appear in the next app update.

### HTTP / WiFi connection issues

**`meshtastic.local` (or any `.local` hostname) not found on Windows:**

Windows does not have built-in mDNS resolution. `.local` hostnames require **Bonjour** (installed with iTunes or Apple Devices). Install either:

- [iTunes](https://www.apple.com/itunes/): includes Bonjour automatically
- [Bonjour Print Services for Windows](https://support.apple.com/en-us/search?query=Bonjour%20Print%20Services%20for%20Windows): standalone Bonjour installer

Alternatively, enter the device's **IP address** directly instead of its `.local` hostname.

> A yellow warning is shown below the address input on Windows as a reminder.

**IPv6 address format:**

Bare IPv6 addresses (e.g. `fe80::1`) must be wrapped in brackets when entered in the HTTP address field: `[fe80::1]`. The app normalises bare addresses automatically, but entering `[fe80::1]:443` (with port) is the most reliable form.

### MQTT: "Connection lost after N reconnect attempts"

**Cause**: Broker unreachable, bad credentials, or wrong port.

**Fix**: Verify the broker URL, port (default 1883, or 8883 for TLS), and username/password. Check that your firewall allows outbound connections on the broker port.

### MQTT: "Subscribe failed"

**Cause**: Topic permission denied on the broker, or wildcards not allowed by the broker ACL.

**Fix**: Confirm the broker's ACL allows your client to subscribe to the configured topic prefix.

### MQTT keeps disconnecting

**Cause**: Wireless interference, broker downtime, or token issues (LetsMesh/Colorado Mesh).

**Fix**:

- Check your WiFi/signal strength
- Verify the broker is online
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

### BLE auto-reconnect: "No previously connected BLE device found"

**Cause**: The reconnect card appeared, but the browser lost the cached device handle; for example, the app was fully quit and relaunched.

**Fix**: Click **Forget this device** on the reconnect card and pair fresh using the Bluetooth picker.

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

### Map tab without internet (offline / no WAN)

**Basemap tiles:** The map background uses **OpenStreetMap** by default (or **Carto Dark** if selected). On the Map tab, use the **Layers** control under the **online/stale/offline** status counts (top right) to switch basemaps and toggle overlays (node markers, movement trails, waypoints, diagnostic halos). The `TileLayer` is defined in [`MapPanel.tsx`](https://github.com/Colorado-Mesh/mesh-client/blob/main/src/renderer/components/MapPanel.tsx). **Without internet access, new tiles cannot be fetched**, so the basemap may look **blank, gray, or incomplete**, or show only **tiles previously cached** by the embedded browser (caching is best-effort and not guaranteed).

**Overlays:** **Node markers, polylines, position trails, and other vector layers** are separate from the tile layer. If nodes have latitude/longitude (from RF, MQTT, SQLite, or your session), those overlays can still **render on top of a missing or partial basemap**.

**Your position offline:** Use **device GPS** when available, **Fixed Position** on the **Radio** tab, or **static coordinates** in app/GPS settings. See **GPS "Location unavailable" or stuck on the map** above for IP-based fallbacks and manual entry. Positions heard over the mesh do not require internet.

### Verifying offline behavior (manual QA)

With **Wi‑Fi off** or **airplane mode** on, using a **packaged** build if possible:

1. Confirm the app **window loads** and core tabs work; connect via **USB serial** or **BLE** to a local radio if you need RF features.
2. Open the **Map** tab: expect **missing or stale basemap tiles** as described above; **markers and trails** may still appear when position data exists.
3. A non-fatal **update check** message in the console is expected without WAN; see **Update check fails / footer update status** above.

### Diagnostics panel: "restored from last session" banner

**Cause**: Diagnostic rows (routing + RF) are snapshotted to `localStorage` so a restart doesn't wipe the table.

**Fix**: This is expected; rows refresh as new packets arrive. Use **Stop restoring on next launch** on the banner to clear the snapshot, or use **App** tab → **Reset Diagnostics** to clear in-memory rows and related state.

### Diagnostics look stale or overcrowded

**Cause**: RF rows age out faster (default 1 h) than routing rows (default 24 h); very old rows are pruned by timestamp.

**Fix**: In **Network Diagnostics** → Display Settings, adjust **diagnostic row max age** (hours). Or reset diagnostics from the App tab and let the mesh repopulate.

### No signal bars on some nodes

**Cause**: Signal strength is only available for **direct (0-hop) RF** neighbors. Multi-hop and MQTT-heard nodes have no client-side signal strength.

**Fix**: Not a bug; use SNR/last heard and routing diagnostics instead for those paths.

### MeshCore: "Get Telemetry" returns timeout

**Cause**: The remote node has no environment sensors, or the request timed out before the node responded.

**Fix**: Not all nodes support environment telemetry. The error is shown inline in the node detail modal and is safe to ignore.

### MeshCore: "Get Neighbors" button not visible

**Cause**: The button is only shown for **Repeater**-type contacts (contact type 2). Chat and Room contacts do not support the neighbor query command.

**Fix**: Open the node detail modal for a Repeater node (shown as "Repeater" in the hardware model field).

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

### MeshCore: Trace Route or Ping trace times out

**Cause**: Nodes you only **hear** on the mesh; but that do **not** have **your** node in **their** contact list; are sometimes called foreign or one-way contacts. MeshCore firmware may not answer **Trace Route** (node detail) or **Ping trace** (Repeaters panel) for those peers, so the app waits until the trace/ping timeout with no TraceData response. You may see **Trace route timed out** in the node detail modal or an error toast from **Ping trace**.

**Fix**: When possible, exchange contact adds so the remote node lists you as a contact. If you cannot add them (or they never add you), treat the timeout as expected, not a Mesh-Client defect when the radio never returns a result.

### Can't see RF packets on custom MQTT broker

**Cause**: The packet logger publishes to `{prefix}/{pubKey}/packets`, but you're viewing the packets somewhere that doesn't receive published MQTT messages.

**Fix**:

- The app publishes to `meshcore/{IATA}/{pubKey}/packets` (e.g., `meshcore/DEN/AABBCCDDEEFF001122/packets`)
- Use an external MQTT client (like MQTT Explorer, mosquitto_sub, or your broker's dashboard) to subscribe and view the packets
- For Colorado Mesh, subscribe to `meshcore/DEN/+/packets/#`
- For LetsMesh/MeshMapper, subscribe to `meshcore/test/+/packets/#`
- Verify your broker ACL allows publishing to `packets/` topics
- Check the Log panel for "Published RF packet" entries to confirm packets are being sent
