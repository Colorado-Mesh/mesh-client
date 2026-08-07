# Nomad hosting live interop

Manual verification that mesh-client’s static Nomad host interops with other Nomad Network clients. Automated tests cover path hashes, the Link request handler, and My Pages UI; this checklist is for a live stack.

## Prerequisites

- Repo-local `.rsstack/` checkouts (`./scripts/clone-ratspeak-stack.sh`) and an `rns-stack` sidecar build
- Reticulum stack running in mesh-client (Connection → Reticulum)
- Shared path to peers: TCP hub, I2P/Ygg, or RF — same network as the peer client
- Optional: a site folder such as sibling `nomad-page` with `pages/*.mu`

## Host setup (mesh-client)

1. Open **Nomad Network** → **My Pages**.
2. Click **Choose folder** and select a site root (directory containing `pages/`) or the `pages/` directory itself.
3. Set a display name → **Start serving**.
4. Confirm destination hash is shown and **Serving to network** chip appears.
5. Edit a `.mu` file on disk in that folder — the watcher reloads routes without further UI action.
6. Click **Open in browser** — local `index.mu` should load without a second peer.
7. Quit the app (or stop/start the stack), relaunch, start the stack — hosting should resume automatically without toggling Start serving.

## Peer checks

Repeat with each peer you care about:

1. **Python NomadNet** — node appears in announces; open destination; view index page; download a file under `/file/` if present.
2. **MeshChat** (if available on the same network) — same announce → page → file path.
3. **Second mesh-client** — Announces list → open node → page + file download.

## Pass criteria

- Peer sees announce with expected display name (or destination hash).
- `/page/index.mu` content matches what is on disk in the chosen folder.
- Host My Pages does not list dotfiles or `*.allowed`; peer cannot fetch them as content.
- After quit/relaunch with serving left enabled, hosting is running again once the stack is up.
- If the folder is moved/missing after restore: no green Serving chip; My Pages shows an error; `[nomad-serving]` / `[NomadHosting]` warnings appear in `mesh-client.log`, the Analyze modal (`reticulum-nomad-hosting`), and Export for GitHub/Developer bundles.

## Record

Note date, hub/interface used, peer software versions, and pass/fail for page + file in the PR or issue that closes hosting follow-up work.

## Automated stand-ins (CI)

When NomadNet / MeshChat are not installed in the environment:

- `nomad-core` tests: Link request handler serves page + file by path hash; request budget rejects over-concurrency; listing skips dotfiles/`*.allowed`
- mesh-client Vitest: My Pages folder choose, start gated on content source, read-only page/file lists, and **Open in browser** wiring
- Sidecar: content-source layout resolve + persistence of `nomad_serving_content_source`

Treat the peer table above as the release gate for cross-client hosting.
