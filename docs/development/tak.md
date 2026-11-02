# TAK gateway (CoT)

Developer reference for the TAK tab: a local TLS CoT server, a remote TAK server relay, and chat bridging for ATAK, WinTAK, and iTAK. Operator guide: [tak.md](../tak.md). Troubleshooting: [troubleshooting.md — TAK (CoT gateway)](../troubleshooting.md#tak-cot-gateway). MECP in ATAK: [emcomm.md — Reports in ATAK](../emcomm.md#reports-in-atak) and [mecp.md](mecp.md).

## Ownership

**Main owns the network and the secrets.** TLS listeners, certificates, private keys, enrollment, and the remote relay socket all live in the main process. The renderer decides _what_ to publish (nodes, chat, markers, style settings) and sends it over `tak:*` IPC. It never receives a private key.

| Concern                                                                   | Owner                                                                  |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| TLS server, client tracking, CoT framing, held messages                   | Main: `tak-server-manager.ts`                                          |
| CA / server / client certificates, data package                           | Main: `tak/certificate-manager.ts`, `tak/data-package.ts`              |
| Remote relay socket, credentials, enrollment                              | Main: `tak/remote-client.ts`, `remote-credentials.ts`, `enrollment.ts` |
| What to publish, per-protocol node feed, mesh sends for inbound ATAK chat | Renderer: `lib/tak/`, `hooks/useTak*`, stores                          |
| Panel UI                                                                  | Renderer: `Tak*.tsx`                                                   |

**TAK never transmits to RF from main.** Source-policy rule `tak-never-transmits-to-rf` forbids `src/main/tak/**`, `tak-server-manager.ts`, and `ipc/tak-handlers.ts` from importing radio, MQTT, serial, BLE, or Reticulum modules. An ATAK message that must go to the mesh is emitted from the manager as `client-chat` and handled in the renderer (`takInboundChat.ts`), which sends it with the normal protocol send path (`takMeshSend.ts`) so it shows in Chat like any other message.

## Layout

### Main

| Piece                                                                                               | Path                                                                                                     |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Server manager (TLS server, clients, node/chat/DM/incident state, remote relay glue)                | `src/main/tak-server-manager.ts`                                                                         |
| IPC handlers (`tak:*`)                                                                              | `src/main/ipc/tak-handlers.ts` (`registerTakIpcHandlers`, deps injected from `src/main/index.ts`)        |
| CoT builder (node → `<event>`; events are written bare, with no XML declaration)                    | `src/main/tak/cot-converter.ts`                                                                          |
| CoT stream parser (partial event cap, stale clamp)                                                  | `src/main/tak/cot-parser.ts`                                                                             |
| Node update parsing and validation                                                                  | `src/main/tak/node-update.ts`                                                                            |
| Inbound contact cache (one renderer update per interval, capped)                                    | `src/main/tak/contact-cache.ts`                                                                          |
| Local certificate lifecycle (`loadOrGenerateCerts`, `regenerateCerts`, `serverCertMatchesIdentity`) | `src/main/tak/certificate-manager.ts` (`userData/tak-certs`)                                             |
| ATAK data package (zip with `truststore.p12`, `client.p12`, `connection.pref`, manifest)            | `src/main/tak/data-package.ts` (`userData/tak-package.zip`)                                              |
| LAN IP choice (skips docker/VPN/virtual adapters)                                                   | `src/main/tak/lan-ip.ts`                                                                                 |
| GeoChat, channel chat, DM, and peer CoT: builders and IPC parsers                                   | `src/main/tak/geochat-cot.ts`                                                                            |
| MeshCore `@name` reply resolution on channels                                                       | `src/main/tak/channel-replies.ts`                                                                        |
| MECP incident spot markers and alarm CoT                                                            | `src/main/tak/incident-cot.ts`                                                                           |
| Advertised role to default unit style                                                               | `src/main/tak/advertised-style.ts`                                                                       |
| Unit filter matching and style settings persistence                                                 | `src/main/tak/unit-filters.ts`, `style-settings.ts` (shared matcher: `src/shared/takUnitFilterMatch.ts`) |
| Remote relay client (TLS or plain TCP, backoff reconnect, buffer cap)                               | `src/main/tak/remote-client.ts`                                                                          |
| Remote settings (`tak-remote-settings.json`)                                                        | `src/main/tak/remote-settings.ts`                                                                        |
| Remote credentials (CA, client cert, key via `safeStorage`)                                         | `src/main/tak/remote-credentials.ts` (`userData/tak-remote-certs`)                                       |
| Remote enrollment (HTTPS to the enrollment port, keypair made locally)                              | `src/main/tak/enrollment.ts` (default port 8446)                                                         |
| Shared types and limits                                                                             | `src/shared/tak-types.ts` (`TAK_CHAT_HELD_MAX`, `TAK_NODE_UPDATE_BATCH_MAX`, …)                          |

### Preload and IPC channels

Exposed on `electronAPI.tak` in `src/preload/index.ts`, typed in `src/shared/electron-api.types.ts`. Every handler calls `assertIpcSender`.

| Group                    | Channels                                                                                                                                                                                                      |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local server             | `tak:start`, `tak:stop`, `tak:getStatus`, `tak:getConnectedClients`, `tak:getContacts`                                                                                                                        |
| Certificates and package | `tak:generateDataPackage`, `tak:regenerateCertificates`                                                                                                                                                       |
| Publishing               | `tak:pushNodeUpdates`, `tak:pushChatMessage`, `tak:setChatChannels`, `tak:retireChatRooms`, `tak:pushDirectMessage`, `tak:setDirectMessaging`, `tak:setDirectPeers`, `tak:setIncidentMarkers`, `tak:dmStatus` |
| Styles                   | `tak:getStyleSettings`, `tak:setStyleSettings`                                                                                                                                                                |
| Remote relay             | `tak:remoteStart`, `tak:remoteStop`, `tak:remoteGetStatus`, `tak:remoteGetSettings`, `tak:remoteGetCredentials`, `tak:remoteImportCredentials`, `tak:remoteEnroll`, `tak:remoteClearCredentials`              |

### Renderer

| Piece                                                                                     | Path                                                                                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tab panel (status, server settings, clients, data package, certificates, plugin messages) | `src/renderer/components/TakServerPanel.tsx`                                                                                        |
| Remote relay section                                                                      | `src/renderer/components/TakRemoteRelaySection.tsx`                                                                                 |
| Unit filters and icons                                                                    | `src/renderer/components/TakUnitFiltersSection.tsx`                                                                                 |
| Channel and direct message sections                                                       | `src/renderer/components/TakChannelRelaySection.tsx` (`TakDirectMessagesToggle`, `TakDirectMessagesSection`)                        |
| Server / relay / contacts / style hooks                                                   | `hooks/useTakServer.ts`, `useTakRemoteRelay.ts`, `useTakContacts.ts`, `useTakStyleSettings.ts`                                      |
| Node replicator (feeds all protocols; re-sends positions every 5 min)                     | `hooks/useTakNodeReplicator.ts`, `lib/takNodeFeed.ts`                                                                               |
| Inbound ATAK chat to mesh                                                                 | `hooks/useTakInboundChat.ts`, `lib/tak/takInboundChat.ts`, `takMeshSend.ts`, `takEchoGuard.ts`, `takSeenOnce.ts`, `takReplyText.ts` |
| Served channels, names, and relay                                                         | `lib/tak/takServedChannels.ts`, `takChannelNames.ts`, `takChannelRelay.ts`, `takGeochatPush.ts`                                     |
| Direct messages                                                                           | `lib/tak/takDirectMessages.ts`, `takDmStatus.ts`                                                                                    |
| MECP text and markers                                                                     | `lib/tak/takMecpText.ts`, `takIncidentMarkers.ts`                                                                                   |
| Marker symbol                                                                             | `lib/tak/takSymbol.ts`                                                                                                              |
| Remote error text                                                                         | `lib/takRemoteUserError.ts` (`takServerPanel.remoteErrors.*`)                                                                       |
| ATAK plugin packet decode (Meshtastic)                                                    | `lib/meshtastic/takPacketDecode.ts`                                                                                                 |
| Stores                                                                                    | `stores/takRelayPrefsStore.ts`, `takChannelStore.ts`, `takContactStore.ts`, `takTrackerStore.ts`, `takSinkStore.ts`                 |
| Settings search                                                                           | `lib/settingsSearchEntries/tak.ts`                                                                                                  |
| Copy                                                                                      | `takServerPanel.*` and `takContacts.*` in `src/renderer/locales/en/translation.json`                                                |

## Behaviour invariants

- **Defaults.** Port 8089, server name `mesh-client`, `requireClientCert: true`, `autoStart: false`. Local port must be 1024–65535; the remote port uses the shared 1–65535 TCP port bounds and `isValidConnectHost`.
- **mTLS.** The server sets `requestCert` and `rejectUnauthorized` from `requireClientCert`.
- **Certificates.** The server certificate carries the server name and LAN IP in its SAN (`serverCertMatchesIdentity` decides when a stored certificate is stale). `regenerateCerts` invalidates all packages by design.
- **Data package.** The CA ships as a password-protected PKCS#12 truststore (`certs/truststore.p12`, alias `mesh-client-ca`, password `atakatak`), not PEM: ATAK loads `caLocation` as PKCS#12 and a PEM leaves the truststore empty. The write is atomic (temp file, then rename) and cleans up the temp file on failure.
- **CoT framing.** Events are written bare. A `<?xml?>` declaration is legal only at the start of a document, so a declaration on each event made ATAK drop all but the first.
- **Remote relay trust.**
  - Verification on (default): chain to the imported CA, or to system roots when no CA is imported, and the certificate must name the host.
  - Name-mismatch opt-out requires verification on and an imported CA.
  - Verification off, or plain TCP: never auto-connects at launch. The UI also disables **Connect on application launch** in both cases.
  - Reconnect uses a doubling backoff capped at `TAK_REMOTE_RECONNECT_MAX_MS` (30 s). The backoff resets only after the stream stays up long enough. A manual stop never reconnects. The socket write buffer is capped at `TAK_REMOTE_MAX_BUFFERED_BYTES` (1 MiB).
- **Enrollment.** Keypair is generated locally. The server is contacted over HTTPS with Basic auth on the enrollment port. The username may not contain `:` or control characters, the password is capped at 1024 characters and is never stored. The response is capped at 256 KiB, a certificate for a different key is rejected (`enrollKeyMismatch`), and verification must be on.
- **Credential import.** Files are read through a single handle with type and size checks that apply to the bytes actually read (cap `TAK_CREDENTIAL_FILE_MAX_BYTES`, 256 KiB; at most `TAK_CREDENTIAL_FILES_MAX`, 4 files). `O_NONBLOCK` stops a FIFO pick from blocking. A truststore-only import leaves a previously imported client certificate alone.
- **Key storage.** The client key is encrypted with `safeStorage` (`client-key.pem.enc`) when async encryption is available. Otherwise `client-key.pem` is written with mode `0o600`. Writes are atomic.
- **Channel messaging.**
  - Served channel settings are keyed per channel, not per slot. `tak:retireChatRooms` tells ATAK to drop old room contacts.
  - Sending to a channel is opt-in per channel, prefixed with the sender's callsign unless **Add callsign** is off, cut to fit one mesh message, and limited to 10 messages a minute per device.
  - Up to `TAK_CHAT_HELD_MAX` (50) messages heard while no ATAK device is connected are held for the first device to connect.
  - MeshCore `@name` / `@@` replies resolve through `channel-replies.ts`. Ambiguous prefixes send nothing and post a chat note.
  - A remote-server flag per channel streams it read only to the remote relay.
- **Direct messages.** Per-protocol toggle (`tak:setDirectMessaging`), peers pushed with `tak:setDirectPeers`, delivery status with `tak:dmStatus`. `DM_TRIES` is 4 automatic attempts before a "Not confirmed" note. Pending entries expire after 30 minutes (`PENDING_DM_TTL_MS`). Replies go to the last-writing device, else to all connected devices, and are held while it is away. DMs are never sent to the remote relay.
- **Incidents.** `tak:setIncidentMarkers` carries open incidents with a position (at most 50, most severe first). Markers and the optional MAYDAY alarm are never sent to the remote relay. The alarm (`mecpAlarm` in `takRelayPrefsStore`) applies at once, running or not, and ATAK drops an uncancelled alarm after 30 minutes.
- **Node feed.** All three protocols feed one stream: Meshtastic and MeshCore nodes within their online window, Reticulum RMAP interfaces with coordinates, and the user's own Reticulum position when a static GPS position is set. `parseTakNodeUpdate` validates every IPC batch (`TAK_NODE_UPDATE_BATCH_MAX`).
- **Unit styles.** The first enabled matching filter wins. A filter with no name pattern matches every node of its kind or protocol. Repeater and room icons follow the node kind, not the filter. `sendUnmatched` decides whether unmatched nodes are relayed.
- **Status.** One status-bar label combines the local server and the remote relay.

## Security invariants

- **IPC.** Every `tak:*` handler calls `assertIpcSender`, validates its payload (`validateTakSettings`, `validateTakRemoteSettings`, the `parseTak*` helpers), and logs failures through `sanitizeLogMessage`. Never expose `ipcRenderer`. Credential channels return a summary (`TAKRemoteCredentialSummary`), never key material.
- **Secrets.** Private keys and passwords stay in main. Passwords are not logged or persisted, and `remoteEnroll` receives them once.
- **No RF from main.** See the source-policy rule above.
- **Temp files.** Any new test that writes to disk uses `mkdtempSync` under `os.tmpdir()` (`check:insecure-temp-files`).
- **Protocol parity.** The panel, node feed, and DM sections cover Meshtastic, MeshCore, and Reticulum. Gate protocol-specific sections (tracker channels, ATAK plugin packets) with `ProtocolCapabilities` (`hasTakTrackerChannels`, `hasAtakPlugin`), never with `protocol ===` checks.
- **i18n.** All user text lives under `takServerPanel.*` and `takContacts.*`. Remote error codes map to `takServerPanel.remoteErrors.*` through `takRemoteUserError.ts`.
- **Failure behaviour.** Writes that must not corrupt state (certificates, credentials, settings, the data package) are atomic. A failed package write throws and removes its temp file. A failed reveal in the file manager is logged and non-fatal. Handlers log and rethrow so the hook can show the error.

## Tests

| Area                     | Files                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server manager           | `src/main/tak-server-manager.test.ts`                                                                                                                                                                   |
| IPC                      | `src/main/ipc/tak-handlers.test.ts`                                                                                                                                                                     |
| CoT convert / parse      | `src/main/tak/cot-converter.test.ts`, `cot-parser.test.ts`, `node-update.test.ts`                                                                                                                       |
| Certificates and package | `certificate-manager.test.ts`, `data-package.test.ts`, `data-package.truststore.test.ts`, `lan-ip.test.ts`                                                                                              |
| Remote relay             | `remote-client.test.ts`, `remote-settings.test.ts`, `remote-credentials.test.ts`, `enrollment.test.ts`                                                                                                  |
| Chat, DMs, incidents     | `geochat-cot.test.ts`, `channel-replies.test.ts`, `incident-cot.test.ts`, `contact-cache.test.ts`                                                                                                       |
| Styles                   | `unit-filters.test.ts`, `style-settings.test.ts`, `advertised-style.test.ts` (all under `src/main/tak/`)                                                                                                |
| Panel                    | `src/renderer/components/TakServerPanel.test.tsx`, `TakRemoteRelaySection.test.tsx`, `TakUnitFiltersSection.test.tsx`, `TakChannelRelaySection.test.tsx`                                                |
| Hooks and stores         | `useTakContacts.test.ts`, `useTakRemoteRelay.test.ts`, `useTakNodeReplicator.test.ts`, `useTakInboundChat.test.tsx`, `takContactStore.test.ts`, `takTrackerStore.test.ts`, `takRelayPrefsStore.test.ts` |
| Renderer lib             | `src/renderer/lib/tak/*.test.ts`, `takNodeFeed.test.ts`, `takRemoteUserError.test.ts`, `meshtastic/takPacketDecode.test.ts`                                                                             |
| Policy                   | `src/architecture/sourcePolicy.test.ts` (rule `tak-never-transmits-to-rf`)                                                                                                                              |

When changing CSP, IPC limits, or log filters, update `src/main/index.contract.test.ts`.

## Related

- [TAK gateway (operator guide)](../tak.md)
- [EMCOMM: Reports in ATAK](../emcomm.md#reports-in-atak), [mecp.md](mecp.md), [emcomm.md](emcomm.md)
- [Troubleshooting — TAK (CoT gateway)](../troubleshooting.md#tak-cot-gateway)
- [Settings search](settings-search.md) (`lib/settingsSearchEntries/tak.ts`)
- [Renderer hooks](renderer-hooks.md), [Chat](chat.md)
