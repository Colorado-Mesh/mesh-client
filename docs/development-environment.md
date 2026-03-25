# Development Environment Setup

This guide covers local development setup for Mesh Client, including cloning, prerequisites, test harness tooling, and OS-specific troubleshooting.

## Shared Requirements and Tooling

These requirements apply to all platforms.

### 1) Required software

- Git
- Node.js **25.8.1+** (prefer the latest stable release for development when possible)
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

For Fedora / Bazzite / Aurora (inside a Distrobox/Toolbox):

```bash
sudo dnf install cups-libs nspr nss atk at-spi2-atk libXcomposite libXdamage libXrandr mesa-libgbm alsa-lib libdrm libxshmfence cairo
```

If GTK/Pango/GDK runtime shared objects are missing, install:

```bash
sudo dnf install libgtk-3.so.0 libgdk-3.so.0 libpangocairo-1.0.so.0 libpangoft2-1.0.so.0 libgdk_pixbuf-2.0.so.0
```

If your environment needs development headers (for example, native build/debug tooling), install:

```bash
sudo dnf install cairo-devel pango-devel nspr-devel nss-devel cups-devel atk-devel at-spi2-atk-devel libXcomposite-devel libXdamage-devel libXrandr-devel mesa-libgbm-devel alsa-lib-devel libdrm-devel libxshmfence-devel
```

For Ubuntu / Debian:

```bash
sudo apt update
sudo apt install libcups2 libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libasound2 libdrm2 libxshmfence1 libcairo2
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

### Linux Bluetooth (BLE) Permissions

BLE scanning with `@stoprocent/noble` requires `CAP_NET_RAW`.

When running from source, preferred launch is ambient capability with `setpriv`:

```bash
sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc 'npm start'
```

If desktop auth variables are needed:

```bash
sudo setpriv --reuid=$USER --regid=$(id -g) --init-groups --inh-caps +net_raw --ambient-caps +net_raw --reset-env bash -lc "export DISPLAY=$DISPLAY; export XAUTHORITY=$XAUTHORITY; npm start"
```

If you see lines like `cannot create /sys/kernel/debug/bluetooth/hci0/conn_min_interval: Permission denied`, those are emitted by native noble internals trying to write debugfs connection tuning. Those lines alone do **not** prove `CAP_NET_RAW` is missing and can appear even when `setpriv` is correct.

Treat this as actionable only when paired with BLE data-path failures (for example, MeshCore protocol handshake timeout with zero inbound `fromRadio` packets). In that case: keep the device awake/nearby, reset the adapter (`bluetoothctl power off; power on`), retry, or use Serial/TCP fallback.

If you reinstall dependencies (`npm install`/`npm ci`) or switch binaries, re-apply capability setup.

### Sandbox and ARM notes

If app launch fails due to sandbox on some environments:

```bash
npm run dev -- --no-sandbox
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
npm run build && npx electron . --no-sandbox --disable-gpu
```

Or:

```bash
npm run electron:open -- --no-sandbox --disable-gpu
```

Optional persistent mitigation:

- `export MESH_CLIENT_DISABLE_GPU=1`
- `ELECTRON_OZONE_PLATFORM_HINT=x11 npm run electron:open -- --no-sandbox`

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
