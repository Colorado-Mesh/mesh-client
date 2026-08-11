# Agent reference: headless server mode

Deep subsystem reference for AI assistants. Open when a task touches HTTP/WS remote control, container auto-detect, or the Docker image.

## Layout

| Path                                                                                         | Role                                                         |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| [`src/shared/headless.ts`](../../src/shared/headless.ts)                                     | Env parse, docker detect, bind/token policy, knobs           |
| [`src/shared/remoteProtocol.ts`](../../src/shared/remoteProtocol.ts)                         | Wire types + `isClientInputMessage`                          |
| [`src/main/headless/remote-server.ts`](../../src/main/headless/remote-server.ts)             | HTTP/WS server, capture, auth, input                         |
| [`src/main/headless/remote-control-page.ts`](../../src/main/headless/remote-control-page.ts) | Static English control/401 HTML                              |
| [`src/main/index.ts`](../../src/main/index.ts)                                               | Window flags, init/rebind, recreate, shutdown                |
| [`src/main/fatal-startup-dialog.ts`](../../src/main/fatal-startup-dialog.ts)                 | Headless: log-only fatals; schema upgrade needs explicit env |
| [`Dockerfile`](../../Dockerfile) / [`docker/entrypoint.sh`](../../docker/entrypoint.sh)      | Product image + Xvfb supervisor                              |

## Invariants

- Gate with `isHeadlessServerMode()` / `IS_HEADLESS_SERVER_MODE` — not ad-hoc `process.env` checks elsewhere.
- `headlessBindRequiresToken(host)`: refuse start when non-loopback host and empty token.
- Publish `headlessRemoteServer` **after** successful `start()`; use `setTargetWindow` on recreate.
- `stop()` must cancel in-flight starts (`startGeneration`), `terminate()` sockets, timeout `close`.
- First WS client is the input controller; others view-only.
- Control-page HTML is English-only by design (`check:i18n` does not scan it).
- Tests: inject `dockerDetect` / mock `isHeadlessServerMode` — do not rely on host `/.dockerenv`.

## Human docs

[../headless-server.md](../headless-server.md)
