# Development Environment Setup

This guide covers local development setup for Mesh Client, including cloning, prerequisites, test harness tooling, and OS-specific troubleshooting.

## Shared Requirements and Tooling

These requirements apply to all platforms.

### 1) Required software

- Git
- Node.js **22.12.0+** (match [CI](https://github.com/Colorado-Mesh/mesh-client/blob/main/.github/workflows/ci.yaml); `CONTRIBUTING.md` recommends the same)
- npm **9+**
- Python 3 + `pip` (needed for MkDocs documentation build)

Verify:

```bash
git --version
node --version
npm --version
```

### MkDocs (documentation) tooling

Docs are built with MkDocs Material.

1. Create and activate a local virtual environment (recommended on macOS/Homebrew Python because of PEP 668 externally managed environments):
   - macOS/Linux:
     - `python3 -m venv .venv`
     - `source .venv/bin/activate`
   - Windows PowerShell:
     - `py -3 -m venv .venv`
     - `.\.venv\Scripts\Activate.ps1`
2. Install the docs dependencies:
   - `npm run docs:install`
   - or (manual): `python3 -m pip install -r docs/requirements.txt`
3. Build locally:
   - `npm run docs:build`
4. Preview locally:
   - `npm run docs:serve`

If `npm run docs:install` fails with `externally-managed-environment`, activate `.venv` and rerun.

### 2) Clone and install

```bash
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
npm install
```

If you are updating from an older clone, use a clean install when troubleshooting native module issues:

```bash
rm -rf node_modules package-lock.json
npm install
```

### 3) Run the app

- Dev mode (hot reload): `npm run dev`
- Production-like local start: `npm start`

### Common npm commands

Use these from the repository root:

```bash
# App run/build
npm run dev
npm start
npm run build

# Platform packaging (binary artifacts in release/)
npm run dist:mac
npm run dist:linux
npm run dist:win

# Quality checks
npm run test:run
npm run lint
npm run typecheck
npm run format:check

# Docs
npm run docs:install
npm run docs:build
npm run docs:serve
```

### 4) Test harness setup and local quality checks

This section is the project test harness setup.

Installed via `npm install` (from `package.json`):

- `vitest` and renderer/main test dependencies
- `eslint`
- `typescript`
- `prettier`

Not installed by npm (install separately when needed):

- `actionlint` (recommended for workflow linting; run `npm run setup:actionlint` or install system-wide)
- `docker` and `act` (only if you run GitHub Actions locally)
- Python 3 + `venv` + MkDocs Python deps (for docs checks/builds)

Run these quality checks before opening a PR:

```bash
npm run test:run
npm run lint
npm run typecheck
npm run format:check
```

Other useful test commands:

- `npm test` (watch mode)
- `npm run test:verbose` (verbose failures)

### 5) Building a distributable

Use the platform-specific packaging command:

```bash
npm run dist:mac      # macOS -> .dmg + .zip in release/
npm run dist:linux    # Linux -> .AppImage + .deb in release/
npm run dist:win      # Windows -> .exe installer in release/
```

Output goes to the `release/` directory.

### 6) Git hooks and pre-commit behavior

After `npm install`, repo hooks are enabled via `core.hooksPath` and pre-commit runs checks (format, lint, typecheck, audit, actionlint, tests).

Emergency bypass is available:

```bash
git commit --no-verify
```

Use this only as a temporary escape hatch, then run the skipped checks manually as soon as possible.

### 7) CI workflow tooling (optional but recommended)

- **Docker** (required to run `act` locally)
- **act**: run GitHub Actions locally with Linux amd64 parity:

```bash
act --container-architecture linux/amd64
```

- **actionlint**: required for local pre-commit if workflow files are touched.

### 8) Helper scripts (auto-install where possible)

These scripts try to install optional tooling automatically. If they fail (for example, missing `sudo`/admin rights), follow the manual steps in this doc instead.

1. Install `actionlint` (used by the git pre-commit hook):
   - `npm run setup:actionlint`
   - This installs into `.githooks/bin` so the hook can find it.
2. Install native build dependencies:
   - `npm run setup:build-deps`
   - Linux/macOS: attempts to install what native builds need (requires sudo where applicable).
   - Windows: prints a message to install Visual Studio Build Tools manually.
3. (Linux only) Fix serial port permissions:
   - `npm run setup:dialout`
   - Adds your user to the `dialout` group (requires sudo + re-login).

### 9) Optional editor/tooling

- VS Code (or Cursor) with TypeScript + ESLint support
- Prettier editor extension (optional convenience; repository already defines formatting rules)
- React DevTools for renderer debugging

## macOS

### Install prerequisites

1. Install Git (Xcode CLT includes it):
   ```bash
   xcode-select --install
   ```
2. Install Node 25 (recommended via nvm) and npm:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
   export NVM_DIR="$HOME/.nvm"
   [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
   nvm install 25
   nvm use 25
   ```

### Build/run flow

```bash
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
npm install
npm run dev
```

### Bluetooth permissions

On first BLE connection, macOS prompts for Bluetooth access. If denied accidentally:

- Go to **System Settings > Privacy & Security > Bluetooth**
- Enable access for Mesh-Client

### macOS release-download note (not required for source development)

If a downloaded app reports "Mesh-client is damaged and can't be opened", remove quarantine:

```bash
xattr -r -d com.apple.quarantine /Applications/Mesh-client.app
```

## Windows

### Install prerequisites

1. Install Git and Node.js (winget primary path):
   ```powershell
   winget install git.git
   winget install OpenJS.NodeJS
   ```
2. Allow npm script execution in current user scope:
   ```powershell
   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
   ```
3. Install **Visual Studio Build Tools** with **Desktop development with C++** workload.
4. Install Python 3 and ensure it is on PATH:
   ```powershell
   winget install Python.Python.3.12
   ```
   If needed, set npm Python path explicitly:
   ```powershell
   npm config set python "C:\\Path\\To\\python.exe"
   ```

### Build/run flow

```powershell
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
npm install
npm run dev
```

### Serial device driver reminder

If serial ports do not appear, install the right USB UART driver (for example CH340/CH341, CP210x, or FTDI).

### Troubleshooting

#### "Could not find any Visual Studio installation to use"

Cause: outdated `node-gyp` resolution or missing C++ build tools workload.

Fix:

1. Install/confirm Visual Studio Build Tools with Desktop C++ workload.
2. Upgrade node-gyp:
   ```bash
   npm install node-gyp@latest -g
   npm install node-gyp@latest --save-dev
   ```
3. Restart terminal and rerun:
   ```bash
   npm install
   ```

#### "Could not find any Python installation to use"

Cause: Python missing or not on PATH for node-gyp.

Fix:

1. Install Python 3 and add it to PATH.
2. Restart terminal.
3. Retry `npm install` (or `npm run dist:win`).
4. If still failing, set Python path with `npm config set python ...`.

#### `dist:win` fails with path spaces or `EPERM`

- Prefer a path without spaces (for example `C:\dev\mesh-client`)
- Close running Electron/Node processes before rebuild
- Run:
  ```bash
  npm run rebuild
  npm run dist:win
  ```

## Linux

### Install prerequisites

Install Node 25, `make`, and C++ build tools (`g++`/`gcc-c++`) with native build dependencies.

Debian/Ubuntu:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 25
nvm use 25
sudo apt install build-essential
sudo apt install python3 libnspr4 libnss3
```

Fedora/RedHat:

```bash
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm install 25
nvm use 25
sudo dnf install @development-tools
sudo dnf install python3 nspr nss
```

### Build/run flow

```bash
git clone https://github.com/Colorado-Mesh/mesh-client
cd mesh-client
npm install
npm run dev
```

### Serial permissions

Add your user to `dialout`:

```bash
sudo usermod -a -G dialout $USER
```

Log out/in after changing groups.

### Linux Bluetooth (BLE)

Linux uses Web Bluetooth (Chromium's built-in BLE API) instead of `@stoprocent/noble`. This approach:

- Requires no setcap/setuid workaround scripts
- Requires the user to select a device from the in-app Bluetooth picker (backed by Chromium's chooser event)
- Requires a user gesture (button click) to trigger device selection

The app automatically enables `--enable-experimental-web-platform-features` on Linux at startup.

#### Bluetooth Pairing on Linux

Web Bluetooth may invoke the **Electron pairing handler** during GATT connect. Behavior differs by protocol:

- **Meshtastic:** On the first Chromium `providePin` request, the client tries the standard Meshtastic PIN `123456`. If that fails, you are prompted to enter the PIN manually.
- **MeshCore:** The MeshCore session does **not** auto-submit `123456`. When Chromium asks for a PIN, you enter the random code shown on the radio.

**MeshCore and OS-level pairing (Linux / BlueZ):** A stable GATT session usually requires a bond in BlueZ first. After you choose a device in the in-app picker, the client runs `bluetoothctl info <MAC>`. If the device is **not** paired (`Paired: no`) or not yet known to the adapter, the UI prompts for the PIN on the **radio** and runs **`bluetooth-pair`** (main-process `bluetoothctl` pairing) **before** resolving the pending Web Bluetooth selection. If `Paired: yes` already, connection continues without that step.

Handshake retries reuse the **same granted Web Bluetooth device** (`navigator.bluetooth.getDevices()`) so the second attempt does not call `requestDevice()` without a user gesture.

If you encounter pairing issues (e.g., "Connection attempt failed" or device was previously paired with wrong PIN):

1. Use the **"Remove & Re-pair Device"** button in the app
2. Or manually remove via `bluetoothctl`:
   ```bash
   bluetoothctl
   # Inside bluetoothctl:
   remove XX:XX:XX:XX:XX:XX  # Replace with your device MAC
   # Then re-pair from the app
   ```
3. If the device still won't connect, power cycle Bluetooth:
   ```bash
   bluetoothctl power off
   bluetoothctl power on
   ```

### Linux launch notes

The supported dev and local run flows are:

```bash
npm run dev
npm start
```

ARM (for example Raspberry Pi) may also require:

```bash
sudo apt install zlib1g-dev libfuse2
sudo sysctl -w kernel.unprivileged_userns_clone=1
```

### Troubleshooting

#### npm 11: `Unknown env config "devdir"`

```bash
npm config delete devdir
npm config delete devdir --global
unset npm_config_devdir NPM_CONFIG_DEVDIR
```

#### SIGILL during `npm install` (`electron exited with signal SIGILL`)

Install without running Electron rebuild first:

```bash
MESHTASTIC_SKIP_ELECTRON_REBUILD=1 npm install
```

Then run rebuild on a host where Electron executes correctly:

```bash
npm run rebuild
```

#### SIGSEGV on startup (`electron exited with signal SIGSEGV`)

Use:

```bash
npm run build && npx electron . --disable-gpu
```

Or:

```bash
npm run electron:open -- --disable-gpu
```

Optional persistent mitigation:

- `export MESH_CLIENT_DISABLE_GPU=1`
- `ELECTRON_OZONE_PLATFORM_HINT=x11 npm run electron:open`

#### `Serial: serial_io_handler.cc:147 Failed to open serial port: FILE_ERROR_ACCESS_DENIED`

1. Ensure user is in `dialout`.
2. Re-login.
3. Verify with:
   ```bash
   groups
   ```
4. If missing, create and activate:
   ```bash
   sudo groupadd dialout
   sudo usermod -a -G dialout $USER
   newgrp dialout
   ```
