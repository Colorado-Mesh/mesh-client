# Troubleshooting

### npm 11: `Unknown env config "devdir"`

See [development-environment.md](development-environment.md#linux) for setup and troubleshooting details.

### `pnpm install` fails on native module compilation

See [development-environment.md](development-environment.md) for OS-specific prerequisite installation and troubleshooting.

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

- **Bluetooth adapter not found** — ensure Bluetooth is enabled at the OS level. On Linux: `systemctl status bluetooth` and `rfkill list`. On macOS: check **System Settings > Bluetooth**. On Windows: **Settings → Bluetooth & devices**.
- **Device not discovered** — make sure the device is in advertising/pairing mode and within range. Try stopping and restarting the scan.
- If BLE is unreliable, prefer Serial (USB) or TCP/HTTP for a stable connection.

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
  remove XX:XX:XX:XX:XX:XX  # Replace with your device MAC
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

### Linux: `Serial: serial_io_handler.cc:147 Failed to open serial port: FILE_ERROR_ACCESS_DENIED`

See [development-environment.md#linux](development-environment.md#linux) for serial permission recovery steps.

### macOS: File is damaged and cannot be opened

**Cause:** macOS tags downloads with the **`com.apple.quarantine`** extended attribute. For apps that are **not signed with a Developer ID** and **not notarized**, Gatekeeper may show **“File is damaged and cannot be opened”** (or **“Mesh-client” is damaged and can’t be opened**) instead of the usual unidentified-developer prompt. This is a **security / quarantine** behavior and is **common on Apple silicon** for community-built Electron binaries.

**Fix:** Strip quarantine recursively, then launch again — adjust the path if the app is still under **Downloads** or another folder:

```bash
xattr -r -d com.apple.quarantine /Applications/Mesh-client.app
```

**Right-click → Open** on first launch can also help in some cases. Background and discussion: [jeffvli/feishin#104 (comment)](https://github.com/jeffvli/feishin/issues/104#issuecomment-1553914730).

### App crashes on launch (macOS distributable)

- **macOS 26 (Tahoe) + EXC_BREAKPOINT at launch**: electron-builder ad-hoc signing can crash during ElectronMain/V8 init before any app code runs. This repo sets `mac.identity: null` in `electron-builder.yml` so the packaged app is unsigned and avoids that re-sign path; first open may require **Right-click → Open** or clearing quarantine ([macOS: File is damaged…](#macos-file-is-damaged-and-cannot-be-opened) above). For notarized releases, set a real Developer ID in `mac.identity` and retest on macOS 26. See [electron#49522](https://github.com/electron/electron/issues/49522) and [electron-builder#9396](https://github.com/electron-userland/electron-builder/issues/9396).
- This may also be a native module signing issue — try rebuilding: `pnpm run dist:mac`
- If building from source: make sure `pnpm install` completed without errors

### App shows "disconnected" but device is still on

- The Bluetooth connection can drop silently — click Disconnect, then Connect again
- For serial: the USB cable may have been bumped — reconnect

### Connection or transport issues — use Log **Analyze**

Open the **Log** panel (right rail), enable **debug** if needed, reproduce the problem, then click **Analyze**. The app scans recent buffered log lines for patterns (BLE, serial, TCP, MQTT, handshake timeouts, etc.) and lists **suggested next steps**. This complements export/delete: use it before filing an issue so you have concrete log context. Analysis is **heuristic** — treat recommendations as hints, not guarantees.

### Permission messages in the console

`[permissions] checkHandler: media → denied` and `web-app-installation → denied` are expected. The app only uses **serial** and **geolocation** — media and web-app-installation are intentionally denied.

### `pnpm run dist:mac` fails with `GH_TOKEN` / "Cannot cleanup"

electron-builder publishes to GitHub when it thinks it's in CI. Local builds use `--publish never` so artifacts land in `release/` without a token. Tag releases use `pnpm run dist:mac:publish` (and `:linux:publish` / `:win:publish`) with `GH_TOKEN` set — see `.github/workflows/release.yaml`.

### `[DEP0190]` when running electron-builder

Node deprecates `spawn(..., { shell: true })` with an args array. This project patches `app-builder-lib` via `patch-package` so macOS/Linux use `shell: false` for the npm dependency collector. Re-run `pnpm install` if you upgrade electron-builder and the warning returns.

### `duplicate dependency references` during dist

npm's JSON tree lists hoisted packages with many duplicate refs (one per edge). That's expected and not something you need to fix. The **app-builder-lib** patch logs that summary at **debug** only so normal `dist:*` runs stay quiet. To see it: `DEBUG=electron-builder npx electron-builder --mac` (or your usual dist command).

### `[DEP0169]` / `url.parse()` deprecation warning

The app uses npm package overrides to force `follow-redirects` and `cacheable-request` onto versions that use the WHATWG URL API, which removes this warning. To trace the source of any deprecation, run:

```bash
pnpm run trace-deprecation
```

### "A native module failed to load" dialog on startup

**Cause**: `@stoprocent/noble` (or `@serialport/bindings-cpp`) was compiled for a different Electron ABI — common after an Electron or Node version change.

**Fix**: Run `pnpm install` (the postinstall script rebuilds native modules for the correct ABI automatically).

- If you still see dlopen errors after switching machines or OSes, delete `node_modules` and run a clean `pnpm install`.
- **Windows**: Also ensure the [Visual C++ Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist) is installed.

### `dist:win` fails with "space in the path" or `EPERM` on native modules

**Symptoms**

- `Attempting to build a module with a space in the path` during `pnpm run dist:win` (or `pnpm run rebuild`).
- `EPERM: operation not permitted` when the rebuild tries to replace a locked `.node` file.

**Cause**

1. **Spaces in the project path** — node-gyp is unreliable when the repo lives under a path with spaces (e.g. `C:\Users\Joey Stanford\mesh-client`). This can surface as "Attempting to build a module with a space in the path", "Could not find any Visual Studio installation to use", or EPERM. See [node-gyp#65](https://github.com/nodejs/node-gyp/issues/65#issuecomment-368820565).
2. **EPERM on unlink** — Something on Windows still has the `.node` file open (another `node`/`electron` process, antivirus/Windows Defender scanning the file, or a stuck handle).

**Fix**

1. **Use a path without spaces** (strongly recommended): clone or copy the repo to e.g. `C:\dev\mesh-client`, then `pnpm install` and `pnpm run dist:win` from there.
2. **Clear the lock before rebuild**: quit any running Mesh-Client/Electron dev instances, then delete the affected `build` folder under `node_modules` and retry.
3. **Rebuild then dist**: `pnpm run rebuild` — if that succeeds, run `pnpm run dist:win`.

CI builds avoid both issues by using short paths and clean agents; local Windows builds need the same constraints.

### Database directory is not writable

**Error**: `"Database directory is not writable: <path>"`

**Cause**: File permissions on the app's `userData` directory are too restrictive.

**Fix**:

- **Mac/Linux**: `chmod 755 ~/Library/Application\ Support/mesh-client` (or `~/.config/mesh-client` on Linux)
- **Windows**: Right-click `%APPDATA%\mesh-client` → Properties → Security → grant your user Full Control

### HTTP / WiFi connection issues

**`meshtastic.local` (or any `.local` hostname) not found on Windows:**

Windows does not have built-in mDNS resolution. `.local` hostnames require **Bonjour** (installed with iTunes or Apple Devices). Install either:

- [iTunes](https://www.apple.com/itunes/) — includes Bonjour automatically
- [Bonjour Print Services for Windows](https://support.apple.com/kb/DL999) — standalone Bonjour installer

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

### BLE auto-reconnect: "No previously connected BLE device found"

**Cause**: The reconnect card appeared, but the browser lost the cached device handle — for example, the app was fully quit and relaunched.

**Fix**: Click **Forget this device** on the reconnect card and pair fresh using the Bluetooth picker.

### GPS "Location unavailable" or stuck on the map

**Cause**: Browser geolocation was denied, or the device has no GPS fix yet.

**Fix**:

- Grant location permission when prompted by the app.
- Or set coordinates manually via the **Radio** tab → Fixed Position.
- Note: The IP-geolocation fallback (ipwho.is) provides city-level accuracy only — not suitable for position broadcasting. If the service is unreachable, "Location unavailable" is shown.

### "Something went wrong" blank screen

**Cause**: An unhandled React render error, usually from a corrupt or unexpected database value.

**Fix**: Open the **App** tab → **Clear Database**, then restart. If the window never loads at all, delete the SQLite file manually:

- **Mac**: `~/Library/Application Support/mesh-client/`
- **Windows**: `%APPDATA%\mesh-client\`
- **Linux**: `~/.config/mesh-client/`

### macOS: "representedObject is not a WeakPtrToElectronMenuModelAsNSObject" when typing in chat

**Cause**: Known Electron/Chromium quirk on macOS when the first responder is a text field (e.g. the chat input). The native menu bridge logs this; it does not affect behavior.

**Fix**: None required — safe to ignore. Copy/paste and other edit actions still work.

### Update check fails / footer update status

The app functions fully offline — this is not a critical error. If "Update check failed" appears in the console, verify network connectivity. Update checks are rate-limited by the GitHub API and may silently skip when the limit is reached. The footer shows **Update error** when a check fails; use **Check for updates** in the app menu or retry from the footer when applicable.

### Map tab without internet (offline / no WAN)

**Basemap tiles:** The map background uses **OpenStreetMap** raster tiles loaded over HTTPS. The `TileLayer` is defined in [`MapPanel.tsx`](https://github.com/Colorado-Mesh/mesh-client/blob/main/src/renderer/components/MapPanel.tsx). **Without internet access, new tiles cannot be fetched**, so the basemap may look **blank, gray, or incomplete**, or show only **tiles previously cached** by the embedded browser (caching is best-effort and not guaranteed).

**Overlays:** **Node markers, polylines, position trails, and other vector layers** are separate from the tile layer. If nodes have latitude/longitude (from RF, MQTT, SQLite, or your session), those overlays can still **render on top of a missing or partial basemap**.

**Your position offline:** Use **device GPS** when available, **Fixed Position** on the **Radio** tab, or **static coordinates** in app/GPS settings. See **GPS "Location unavailable" or stuck on the map** above for IP-based fallbacks and manual entry. Positions heard over the mesh do not require internet.

### Verifying offline behavior (manual QA)

With **Wi‑Fi off** or **airplane mode** on, using a **packaged** build if possible:

1. Confirm the app **window loads** and core tabs work; connect via **USB serial** or **BLE** to a local radio if you need RF features.
2. Open the **Map** tab: expect **missing or stale basemap tiles** as described above; **markers and trails** may still appear when position data exists.
3. A non-fatal **update check** message in the console is expected without WAN; see **Update check fails / footer update status** above.

### Diagnostics panel: "restored from last session" banner

**Cause**: Diagnostic rows (routing + RF) are snapshotted to `localStorage` so a restart doesn't wipe the table.

**Fix**: This is expected — rows refresh as new packets arrive. Use **Stop restoring on next launch** on the banner to clear the snapshot, or use **App** tab → **Reset Diagnostics** to clear in-memory rows and related state.

### Diagnostics look stale or overcrowded

**Cause**: RF rows age out faster (default 1 h) than routing rows (default 24 h); very old rows are pruned by timestamp.

**Fix**: In **Network Diagnostics** → Display Settings, adjust **diagnostic row max age** (hours). Or reset diagnostics from the App tab and let the mesh repopulate.

### No signal bars on some nodes

**Cause**: Signal strength is only available for **direct (0-hop) RF** neighbors. Multi-hop and MQTT-heard nodes have no client-side signal strength.

**Fix**: Not a bug — use SNR/last heard and routing diagnostics instead for those paths.

### MeshCore: "Get Telemetry" returns timeout

**Cause**: The remote node has no environment sensors, or the request timed out before the node responded.

**Fix**: Not all nodes support environment telemetry. The error is shown inline in the node detail modal and is safe to ignore.

### MeshCore: "Get Neighbors" button not visible

**Cause**: The button is only shown for **Repeater**-type contacts (contact type 2). Chat and Room contacts do not support the neighbor query command.

**Fix**: Open the node detail modal for a Repeater node (shown as "Repeater" in the hardware model field).
