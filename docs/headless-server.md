# Headless server mode (Docker / remote control)

Mesh-Client can run as a **headless server**: the full Electron UI renders into a fixed viewport (often on Xvfb inside a container) and is exposed to browsers over **HTTP + WebSocket** (issue #824).

This is **not** the same as local CI “container mode” (`pnpm run act:ci` / Podman). There is currently **no** CI job that builds or publishes the product image.

## Enablement

Server mode is on when either:

- `MESH_CLIENT_HEADLESS=1` (also `true` / `yes` / `on`), or
- the process detects a container (`/.dockerenv` or `/run/.containerenv`).

Desktop differences in server mode:

- Fixed viewport (not resizable); no tray, updater, or app menu
- Fatal dialogs become logs; schema upgrades require an explicit accept env (see below)
- `window-all-closed` keeps the process alive and recreates the window

## Browser endpoints

| Path          | Auth                  | Purpose                                                  |
| ------------- | --------------------- | -------------------------------------------------------- |
| `GET /`       | Token when configured | Remote control page (canvas + input)                     |
| `GET /health` | Open                  | JSON probe: `ok`, `ready`, `rendererLoaded`, `uptimeSec` |
| `WS /ws`      | Token when configured | JPEG binary frames + JSON input                          |

Open: `http://<host>:<port>/?token=<secret>` (sets an HttpOnly cookie `mesh-remote-token`).

## Environment variables

| Variable                              | Default    | Notes                                                                                           |
| ------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------- |
| `MESH_CLIENT_HEADLESS`                | off        | Force server mode                                                                               |
| `MESH_CLIENT_REMOTE_HOST`             | `0.0.0.0`  | Bind address                                                                                    |
| `MESH_CLIENT_REMOTE_PORT`             | `8000`     | HTTP/WS port                                                                                    |
| `MESH_CLIENT_REMOTE_TOKEN`            | _(empty)_  | **Required** when host is not loopback / `localhost`                                            |
| `MESH_CLIENT_REMOTE_VIEWPORT`         | `1280x800` | Logical `WxH`                                                                                   |
| `MESH_CLIENT_REMOTE_FPS`              | `5`        | 1–15                                                                                            |
| `MESH_CLIENT_REMOTE_JPEG_QUALITY`     | `70`       | 1–100                                                                                           |
| `MESH_CLIENT_REMOTE_WS_HEARTBEAT_SEC` | `30`       | Ping interval                                                                                   |
| `MESH_CLIENT_ACCEPT_SCHEMA_UPGRADE`   | unset      | Must be `1`/`true`/`yes`/`on` for unattended DB upgrades (container entrypoint defaults to `1`) |
| `MESH_CLIENT_BIN`                     | auto       | Packaged binary override (container)                                                            |
| `MESH_CLIENT_EXTRA_ARGS`              | empty      | Extra Chromium flags (container)                                                                |

## Docker image

Build from a Linux `.deb` produced by the **Build Binaries (no release)** workflow (or staged under `release/`):

```bash
gh run download <run-id> -n mesh-client-linux-<sha>
docker build -t mesh-client-headless --platform linux/amd64 .
docker run -d --name mesh-client -p 8000:8000 \
  -e MESH_CLIENT_REMOTE_TOKEN=sekrit \
  mesh-client-headless
```

Entrypoint starts Xvfb `:99`, waits for the display socket, then runs Electron with `--no-sandbox --disable-dev-shm-usage --disable-gpu --disable-gpu-compositing`. Optional radio passthrough: `--device=/dev/ttyUSB0` / `--privileged` (elevated trust).

There are **no** `pnpm` docker scripts yet — use raw `docker build` / `docker run`.

## Security

- Binding `0.0.0.0` without a token is **refused** (cross-origin browsers can open WebSockets).
- Prefer a reverse proxy with **TLS**; the app speaks plain HTTP. Cookie is `HttpOnly; SameSite=Lax` (add `Secure` at the proxy when terminating HTTPS).
- `/health` is intentionally unauthenticated (liveness only).
- Concurrent viewers are capped; only the first connected WebSocket may inject input (others are view-only).
- Control-page chrome is English-only static HTML (outside i18next / `check:i18n`).
- Container runs as root with Chromium `--no-sandbox` today — treat as trusted-operator / private network only.

## Related docs

- Agent deep-dive: [agents/headless.md](agents/headless.md)
- Troubleshooting: [troubleshooting.md](troubleshooting.md#headless-server-mode-and-docker)
- Security policy: [../SECURITY.md](../SECURITY.md)
