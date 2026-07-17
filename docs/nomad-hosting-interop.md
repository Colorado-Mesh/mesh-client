# Nomad hosting live interop

Manual verification that mesh-client’s static Nomad host interops with other Nomad Network clients. Automated tests cover path hashes, the Link request handler, and My Pages UI; this checklist is for a live stack.

## Prerequisites

- Sibling `rsReticulum` / `rsLXMF` / `rsNomad` checkouts and an `rns-stack` sidecar build
- Reticulum stack running in mesh-client (Connection → Reticulum)
- Shared path to peers: TCP hub, I2P/Ygg, or RF — same network as the peer client

## Host setup (mesh-client)

1. Open **Nomad Network** → **My Pages**.
2. Set a display name → **Start serving**.
3. Confirm destination hash is shown and **Serving to network** chip appears.
4. Edit/save `index.mu`; upload a small file (e.g. `readme.txt`) under **Local files**.
5. Click **Open in browser** — local `index.mu` should load without a second peer.

## Peer checks

Repeat with each peer you care about:

1. **Python NomadNet** — node appears in announces; open destination; view index page; download `/file/readme.txt`.
2. **MeshChat** (if available on the same network) — same announce → page → file path.
3. **Second mesh-client** — Announces list → open node → page + file download.

## Pass criteria

- Peer sees announce with expected display name (or destination hash).
- `/page/index.mu` content matches what was saved on the host.
- `/file/readme.txt` downloads match the uploaded bytes.
- Host My Pages does not list dotfiles or `*.allowed`; peer cannot fetch them as content.

## Record

Note date, hub/interface used, peer software versions, and pass/fail for page + file in the PR or issue that closes hosting follow-up work.

## Automated stand-ins (CI)

When NomadNet / MeshChat are not installed in the environment:

- `nomad-core` tests: Link request handler serves page + file by path hash; request budget rejects over-concurrency; listing skips dotfiles/`*.allowed`
- mesh-client Vitest: My Pages file list/delete and **Open in browser** wiring

Treat the peer table above as the release gate for cross-client hosting.
