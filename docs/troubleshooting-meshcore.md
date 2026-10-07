# MeshCore troubleshooting

MeshCore-specific problems. For general connection, Bluetooth, USB serial, MQTT, log analysis, and bug-report help, see [Troubleshooting](troubleshooting.md).

## MeshCore TCP connect stuck or reconnect loop on OpenHop

**Symptoms**: TCP connect stuck on **Connecting**; empty/stale nodes; reconnect thrash on OpenHop / pyMC companions; log lines like `[IPC] meshcore:tcp socket closed … readableEnded=true` during `[useMeshcoreRuntime] initConn getContacts`.

**Cause**: Companion closes TCP mid-handshake or after the contacts dump. Older builds thrashed reconnect before contacts were latched.

**Fix**:

1. Upgrade to a build with MeshCore TCP burst-complete init (peer FIN after `getContacts` latches configured then reconnects; mid-burst FIN aborts cleanly).
2. **Disconnect → Connect** on the Connection panel.
3. Confirm logs show `[useMeshcoreRuntime] initConn getContacts …` completing and nodes populating. Main uses `TCP_NODELAY` + keepalive on the `meshcore:tcp-*` bridge.

**Reconnect ownership:** TCP disconnect/reconnect is owned by `useMeshcoreRuntime` + `rfReconnectController` (single-owner scheduler). Conn side effects **skip** `handleConnectionLost` when `connectType === 'tcp'` so the runtime `meshcore:tcp-disconnected` listener does not double-enter the reconnect scheduler.

## MeshCore TCP / pyMC: initial connect MsgWaiting drain slow or paused

**Symptoms**: After TCP connect to pyMC/OpenHop, the header shows **Fetching queued messages…** or **Message sync paused while the radio is busy…** for one to two minutes; Chat backlog arrives slowly; developer bundle may show `ui.waitingMessagesDrainDeferred: true` and log lines like `requestTelemetry error timeout` ~120s after connect.

**Cause**: Post-connect self telemetry (optional altitude fetch) used to run before proactive MsgWaiting drain and could hold the companion RF lane for up to **120s**. Silent bulk `getWaitingMessages` on TCP also used a **45s** timeout before falling back to one-at-a-time `syncNextMessage`. On busy meshes the companion queue can keep growing during init RPCs (contacts/channels dump, autoadd, MQTT export) before drain starts.

**Fix**:

1. Upgrade to a build that starts MsgWaiting drain right after the contacts/channels dump (not after all post-init side effects), runs post-connect telemetry only after drain, and uses **syncNextMessage-only** silent drain on TCP (pyMC/OpenHop often never answers bulk `getWaitingMessages`).
2. On MeshCore tab, use **Sync now** if the header still shows a backlog after connect.
3. In support bundles, check `ui.meshcoreDrain` for `meshcoreCompanionRepeaterRfBusy`, `meshcoreAdminRpcInFlightCount`, and `meshcoreSilentBulkTimeoutStreak` when triaging repeat reports.

## MeshCore contact delete and sticky Rooms badge

- Deleting a contact from Chat/Contacts removes the SQLite contact row **and** room BBS messages for that `room_server_id` (so Rooms unread cannot outlive the room server).
- Session-local tombstones (`meshcoreLocallyDeletedContacts`) suppress UI resurrection from MQTT/stub merges until a live radio `getContacts` re-adds the id.
- If the radio still has the contact, it may reappear after the next contact dump — delete again on the radio or forget there too.

## MeshCore contact age prune and favorites

Startup maintenance can delete stale MeshCore contacts by age. Important details:

- **`last_advert` is Unix seconds**, not milliseconds. Invalid retention day counts are ignored (they previously caused mass deletes).
- **Favorited contacts are exempt** from age-based deletion.
- Contacts with **`NULL last_advert`** are never age-pruned (only count-based limits apply).
- If favorite stars stopped working after a store migration, update to a build with identity-scoped favorite toggles (`patchNodeFavorited` on the active connection identity).

## MeshCore: UI slow or frozen with large repeater lists (USB serial)

**Symptoms**: Repeaters tab stutters or the whole window stops responding; USB serial sessions feel stuck after Neighbors / Status / Sensor (LPP) actions.

**Common causes**:

- **Large contact/repeater lists (1,000+)** — list tabs virtualize rows, but USB serial still serializes companion RPCs; prefer **Nodes → search** for one repeater instead of scrolling the full Repeaters table.
- **Queued public messages (Sync now)** — MsgWaiting backlog is drained in the background after connect and when the radio pushes event 131 (including after you send). Auto-drain prefers a bulk `getWaitingMessages` pull (header shows **Syncing X / Y…**); if that times out it falls back to one-at-a-time `syncNextMessage` without disconnecting (header shows **Fetched N…**). The **header status indicator** (queued backlog and active sync on any protocol tab; **paused/deferred** state only on the MeshCore tab) shows silent auto-drain or deferred drain behind repeater admin/trace work. Manual **Sync now** still uses bulk with determinate progress. Wait for the indicator to finish before switching tabs during heavy sync.
- **Multi-hop repeater RPCs** (Neighbors, Status, telemetry) share one serialized USB serial queue. Retrying rapidly or querying distant repeaters (8+ hops) can block the link for up to **120 seconds** per request; queued pings up to **180s** each. **Load more** on a neighbor list is another full Neighbors RPC (~120s) — prefer it over re-clicking **Neighbors** (which replaces the first page). Page request size is 50, but firmware reply buffers often return fewer rows.
- **Concurrent Ping + Status** — MeshCore allows only **one traceroute at a time** on the RF link; multiple pings are queued serially. Status/Neighbors/Sensors wait for an in-progress ping to finish before using the companion queue (see [Serialized traceroutes](meshcore-meshtastic-parity.md#serialized-traceroutes-protocol-requirement)).

**Fix**:

1. Stay on **Nodes** or **Chat** for day-to-day use; open **Repeaters** only when you need bulk repeater admin.
2. Avoid repeated **Neighbors** / **Status** clicks on the same repeater while a request is in progress; use **Load more** when the heading total exceeds the listed rows.
3. After **sleep or hibernate**, if MeshCore does not reconnect automatically, use **Disconnect → Connect** on the Connection panel.
4. If the UI freezes completely on USB serial, **quit mesh-client** (not only Disconnect), unplug/replug USB if needed, reopen, and **Select serial port**. See also [USB serial frozen](troubleshooting.md#meshcore--meshtastic-usb-serial-app-frozen-or-stuck-on-reconnecting).

## MeshCore reply misquote / duplicate chat messages

**Reply misquote cause:** The official MeshCore companion firmware sends unkeyed replies — `@[Display Name] body` — without identifying the parent message. The receiving client makes a best-guess match using the most recent message from that sender, which is wrong when the user replies to an older message. This is a wire protocol limitation, not a bug in any single client.

The client deduplicates overlapping RF and MQTT hears within **5 minutes** (cross-transport and channel RF replay). Room posts and tapbacks use a **60 second** window. A second MQTT-only copy may still appear if both hears arrive via MQTT without RF — that can be expected.

**Reactions on other clients:** By default mesh-client sends tapbacks and text replies as keyless `@[Display Name] …` (official companion wire). Inbound keyed `@[Name#key]` and emoji-only replies render locally as tapback badges via [`meshcorePromoteEmojiOnlyReplyToTapback`](../src/renderer/lib/meshcoreChannelText.ts). Inbound MeshCore Open wire (`r:HASH:INDEX`, `g:GIFID`) is always parsed for display.

**MeshCore Open compatibility (optional):** In **Radio → MeshCore Open wire (experimental)**, enable **MeshCore Open compatibility** to send keyed text replies (`@[Name#key] body`), compact `r:` reactions (fallback to keyless tapback when the emoji is not in the Open index), and `g:` Giphy GIFs (paste URL/ID or use the **GIF** button in Chat). Default off — use only when other nodes on your mesh run MeshCore Open-aware clients. Details: [meshcore-meshtastic-parity.md — MeshCore emoji reactions](meshcore-meshtastic-parity.md#meshcore-emoji-reactions-tapbacks) and [GIF wire](meshcore-meshtastic-parity.md#meshcore-open-gif-wire-ggifid).

## MeshCore: "Get Telemetry" returns timeout

**Cause**: The remote node has no environment sensors, or the request timed out before the node responded.

**Fix**: Not all nodes support environment telemetry. The error is shown inline in the node detail modal and is safe to ignore.

## MeshCore: "Get Neighbors" button not visible

**Cause**: The button is only shown for **Repeater**-type contacts (contact type 2). Chat and Room contacts do not support the neighbor query command.

**Fix**: Open the node detail modal for a Repeater node (shown as "Repeater" in the hardware model field). If the heading total is larger than the listed rows, use **Load more** (Repeaters panel or node detail) instead of re-querying from scratch.

## MeshCore: Status / Sensors / Neighbors toast when disconnected

**Cause**: Status, Telemetry, and Neighbors throw when there is no active MeshCore connection so the Repeaters panel and node detail can show an error toast (previously Status/Telemetry could fail silently).

**Fix**: Reconnect the radio on the Connection panel, then retry the admin action.

## MeshCore: Cannot connect via Bluetooth, USB, or HTTP

**Bluetooth:**

- The device must be **flashed as Companion Bluetooth** (the default BLE flashing mode).
- The device must be **paired** with your computer before connecting:
  - **Windows**: Do **not** pair in Windows Settings. Select the radio in mesh-client. If Windows has no bond for it, mesh-client asks for the **PIN shown on the radio's screen** (radios without a screen use the firmware's fixed PIN) and pairs it for you, the same way the MeshCore web app does in Chrome. A radio that is already paired connects without a prompt.
  - **Linux**: Use **`bluetoothctl pair <MAC>`** first, or let the app handle the pairing prompt. See [BLE known issues](troubleshooting.md#ble-known-issues) for detailed steps.
- **Only one app can be connected at a time.** MeshCore companion firmware accepts a single BLE connection and stops advertising while a phone app (for example the MeshCore iOS/Android app) is connected. The iOS Control Center Bluetooth toggle does not fully turn Bluetooth off, so force-quit the phone app and use **Settings → Bluetooth → Forget This Device** on the phone before pairing with the computer.
- **Windows shows "Connected" for about 1 second, then "Not connected" (never "Paired")**, or mesh-client logs `connect timed out: Bluetooth stack unresponsive` followed by `scan refused: Bluetooth stack unresponsive (… earlier call(s) still stuck)`: Windows pairing did not finish, and the Bluetooth stack is stuck on the half-paired device. mesh-client refuses further scans and connects until that stuck call returns.
  1. On the phone: force-quit the MeshCore app and forget the radio in Bluetooth settings.
  2. On Windows: in **Settings → Bluetooth & devices**, remove every entry for the radio (including duplicates or greyed-out ones).
  3. Power-cycle the radio to drop any hidden connection, then fully restart mesh-client.
  4. Select the radio in mesh-client and enter the **PIN shown on the radio's screen** when asked. If the connect fails again, press **Remove & Re-pair Device** in the connection panel: mesh-client removes the stale Windows bond, asks for the PIN, pairs, and connects.
  5. A wrong PIN keeps the PIN prompt open so you can retry.
  6. If pairing still fails, clear the radio's stored pairings from the MeshCore app or CLI, or connect over USB serial (Companion USB firmware) to confirm the radio works.
- **Try in the official MeshCore app first**: if the device connects there, it will work in Mesh-Client.
- If Bluetooth fails, try serial (USB) or HTTP as alternatives.

**USB (Serial):**

- The device must be **flashed as Companion USB** (not BLE-only firmware).
- If the serial port is not detected, see [Serial port not detected](troubleshooting.md#serial-port-not-detected).

**HTTP (WiFi):**

- The device must be **flashed as Companion HTTP** (not BLE-only firmware).
- If `meshtastic.local` is not resolved, see [HTTP / WiFi connection issues](troubleshooting.md#http--wifi-connection-issues).

## MeshCore: Room server login, posts, and Windows 10

**Minimum Windows**: Mesh-Client (Electron 44) supports **Windows 10 version 1809+** and Windows 11. Windows 10 22H2 is supported; issues reported only on Win10 are usually MeshCore protocol or app regressions, not an unsupported OS. See [System requirements](troubleshooting.md#system-requirements) for the full platform table (including **macOS 13 Ventura+**).

**Rooms vs Chat**: Official MeshCore room clients use the **Rooms** tab BBS login path. Room-server posts appear there (`SignedPlain` / channel `-2`), **not** in Chat channel pills. Admin traffic sent as normal **channel text** shows in **Chat** only.

**Guest / read-only login fails with timeout or "rejected"**:

- Try **blank** Login (or **Continue read-only**) for **read-only** when the room has `allow.read.only` on. That sends **zero password bytes**.
- For **read/write** (post), try the default guest password **`hello`**, or the room’s configured guest password. MeshCore has no passwordless write mode.
- **Room admin CLI** (**Repeaters** tab → room row CLI; needs the room **admin** password via SendLogin ACL, not guest BBS login): many stock room servers use **`hello`** as the default admin password when none was configured. Save the admin password under Repeaters → password for that room.
- Logs showing push **`0x86`** (frame 134) mean **LoginFail** (wrong password or ACL denied). **Room login** rejects immediately on a prefix-matched LoginFail. **Repeater admin login** keeps waiting for a possible LoginSuccess (meshcore.js behavior on congested links); timeout after LoginFail alone is reported as timeout, not wrong password.
- **Admin password** working while guest/read-only fails usually means the guest password on the server does not match what the client sent, or ACL denies read-only login.
- If the room **changed its password** and mesh-client keeps trying to log in, open the **Rooms** tab: expand **Saved passwords** in the sidebar (or use the login overlay for the selected room). Use **Stop auto-login** to stop connect-time retries while keeping the old password stored, or **Forget saved password** to clear the stored guest/admin password and turn off auto-login and auto-sync. After a wrong-password failure, auto-login is turned off automatically until you log in again with **Remember password** or re-enable it.

**MeshCore repeater saved passwords**:

- Per-repeater admin passwords are stored in SQLite as `meshcoreRepeaterCredential:<nodeId>` when you check **Remember** on the repeater auth dialog. Open **Repeaters** → expand **Saved repeater passwords** (sidebar label) to **Forget** a stale entry, or use **Change password** / **Save password** on the node detail modal for a single repeater.
- If **Remember** fails silently, the password still works for the current session (ephemeral secret) but will not survive restart — check the app log for `appSettings:set` errors and retry after updating mesh-client.

**Room post fails with "unsupported on this firmware"**:

- The **companion radio** only accepts **`TXT_TYPE_PLAIN` (0)** for outbound `CMD_SEND_TXT_MSG`. mesh-client sends plain UTF-8 post text after a successful room login. **`TXT_TYPE_SIGNED_PLAIN` (2)** is for **inbound** room-server pushes (author prefix in the wire body); using it for outbound posts returns `ERR_CODE_UNSUPPORTED_CMD` (1). Log out and log in again, then post from the **Rooms** tab while connected over BLE/serial/TCP.

**Garbled prefix (e.g. `ÑÇÕ0`) on inbound room posts**:

- Inbound **SignedPlain** pushes include the **first four bytes of the author public key** before the message body. mesh-client strips that prefix in the **Rooms** UI. If another client shows those characters, it is displaying the raw wire body from the room server.

**Room unread badges**:

- New room BBS posts increment the **Rooms** tab badge and per-room counts on the room list. They do **not** increment the **Chat** tab badge (by design). Stay logged in to receive firmware-pushed posts after login.
- The Rooms badge only counts posts for room servers still in your contact list (`knownRoomServerIds`). Orphan BBS rows (deleted room server) no longer inflate the badge; deleting a room contact also cascades those messages from SQLite.
- Clearing **Chat** channels does not clear Room messages — use App → Danger Zone → clear **Room messages** (or all MeshCore messages) if a badge remains after rooms are gone.

**No room history after login**:

- Room servers keep a **short ring buffer** of recent posts and push anything newer than your companion’s `sync_since` watermark after LoginSuccess. mesh-client resets that watermark (remove+re-add contact) when this device has **no local last-post watermark** yet, then drains waiting messages after login.
- Posts older than the ring (or already past `sync_since`) will not appear. Enable **Auto-sync** on the Rooms tab to periodically re-login while connected so you stay current.
- mesh-client stores posts received while you are logged in on **this device**. Quitting the app or staying logged out for days means posts from that period will not appear later unless they were persisted locally. See the **Rooms** tab history note under Auto-sync.

**pyMC / server console shows posts but Rooms tab does not (cross-client)**:

- The room **server log** (e.g. pyMC) lists everything the BBS stored. mesh-client and the official app only show posts **pushed to your radio while you are logged in** to that room (see above). Posts made before your login, or while you were logged out, will not appear until someone posts again after you re-login (or use **Auto-sync** to periodically re-login).
- For a fair test: keep **both** clients logged into the **same room** while connected, then post from one side and confirm the other receives it within ~30 seconds on RF.
- mesh-client sends outbound room posts as **`TXT_TYPE_PLAIN`**; inbound BBS pushes use **`TXT_TYPE_SIGNED_PLAIN`** (author prefix stripped in the Rooms UI).

**Room bot stats or system lines in Chat as a DM like `!ac200e59`**:

- That tab label is the room server node id (`!` + 8-digit hex), not a person. Room-server **PLAIN** lines (e.g. `Bot Stats (24h):`) belong in the **Rooms** tab, not **Chat → DMs**. Current builds route `hw_model === 'Room'` traffic to Rooms; reload or refresh messages after upgrading if old rows were stored as DMs.

**Read-only → write upgrade does nothing**:

- After **Continue read-only**, use **Upgrade access** and enter the guest password (often **`hello`**) so the client sends a fresh **SendLogin** with `forceRelogin`. An empty field cannot upgrade write access.

**Long room posts show as `[1/2]`, `[2/2]`…**:

- MeshCore room wire limit is ~160 bytes per post. **mesh-client no longer splits outbound MeshCore posts** (chat, DM, or room) into `[i/N]` parts: on a busy mesh repeaters routinely drop some parts, so the recipient would silently get an incomplete message. Over-limit text is blocked in the composer with an explanatory notice — shorten it or send a few separate shorter messages (see [Limitations; MeshCore single-packet messages](../README.md#limitations)). **Inbound** multi-part posts from other clients are still merged: the **Rooms** tab merges consecutive `[i/N]` chunks from the same sender for display, though other clients may show them as separate lines.

**Queue badge stuck at `Q: 255/256`**:

- Usually means the companion radio outbound queue is nearly full. Enable debug logging and export logs if the badge stays red for minutes with no traffic; look for `[useMeshcoreRuntime] high queue depth=`.
- Some **HTTP/TCP** companions pad the legacy 7-byte STATS CORE frame to 9 bytes with `raw[7]=0` and `raw[8]=0xff` (padding sentinel) or `raw[8]=0x18` (`RESP_CODE_STATS` framing leak). mesh-client treats those signatures as 7-byte layout (`queue_len` at byte 6). If chat send/receive works but the badge shows a stuck non-zero depth (e.g. `Q: 24/256` with `rawHex` ending in `000018`), upgrade to a build that includes this fix ([#600](https://github.com/Colorado-Mesh/mesh-client/issues/600)).
- On older builds, CORE stats could also be mis-parsed (false `Q: 255/256` with normal traffic).

**Windows packaged updater: `Cannot find module 'semver'`**:

- Fixed by declaring `semver` as a direct production dependency (same class of issue as `builder-util-runtime` on hoisted `dist:win` builds). Updater falls back to GitHub Releases API until you install a build with the fix.

**Windows packaged updater: `Cannot download … Mesh-client-Setup-….exe status:404` (crash dialog)**:

- `latest.yml` asks for hyphenated Setup names. GitHub stored dotted names when CI uploaded spaced NSIS filenames (`Mesh-client Setup {version}.exe` → `Mesh-client.Setup.{version}.exe`). Download the installer from [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases) manually (dotted or hyphenated name). Repair steps for a published release: [release-process.md](release-process.md#repair-windows-updater-assets-on-an-already-published-release).

**Retest checklist (after upgrading from a known-good build)**:

1. Connect MeshCore over TCP or BLE; confirm nodes load.
2. Open **Rooms** → try **blank** Login for read-only (or **Continue read-only**). For posting, try **`hello`** (default read/write guest password) or the room’s guest password.
3. Post as admin; confirm the post appears in the **official Android app** on the same room (SignedPlain BBS path).
4. Confirm room posts appear in **Rooms** with unread badges (not Chat channel pills).
5. On **Connection** tab, receive a **channel** message on a channel you are not viewing → rail **Chat** badge and red pill on that channel when you open Chat.
6. Export logs (**Log → Export**) if login still fails; include `[meshcoreRoomLoginRpc]` and `[useMeshcoreRuntime] sendRoomPost` lines.

## MeshCore: Trace Route or Ping trace times out

**Cause**: Nodes you only **hear** on the mesh; but that do **not** have **your** node in **their** contact list; are sometimes called foreign or one-way contacts. MeshCore firmware may not answer **Trace Route** (node detail) or **Ping trace** (Repeaters panel) for those peers, so the app waits until the trace/ping timeout with no TraceData response. You may see **Trace route timed out** in the node detail modal or an error toast from **Ping trace**.

**Parallel pings**: MeshCore does **not** allow parallel traceroutes on one radio. mesh-client queues them, but two back-to-back pings can take up to **180s** each (including 0-hop direct-retry). **Status/Neighbors/Telemetry** use **120s** timeouts and wait for the active trace (TraceData) and same-node ping wrapper to finish first. Prefer **one ping at a time** when troubleshooting. See [meshcore-meshtastic-parity.md — Serialized traceroutes](meshcore-meshtastic-parity.md#serialized-traceroutes-protocol-requirement).

**Multi-hop route priming / no route**: When outbound path bytes are missing but the UI shows multi-hop, ping/trace first waits passively for PathUpdated (129) and contact refresh (**15s + 5s × hops**, capped at **45s**). For **2+ hops**, if that still yields no usable hash-segment path, mesh-client may run up to **two** flood-advert priming rounds before `SendTracePath` (listener registered **before** each advert). **1-hop** targets may use a synthesized `[relayPrefix, destPrefix]` path when a direct 0-hop repeater is known. If priming and synthesis still fail, ping may fail fast with **No route from radio yet** instead of waiting the full trace timeout. One-way contacts may still time out with no TraceData after priming.

**Fix**: When possible, exchange contact adds so the remote node lists you as a contact. If you cannot add them (or they never add you), treat the timeout as expected, not a Mesh-Client defect when the radio never returns a result. For multi-hop repeaters, wait for contact/path updates or run **Ping trace** once before CLI (Repeaters panel auto-pings on first multi-hop CLI when no trace exists this session).
