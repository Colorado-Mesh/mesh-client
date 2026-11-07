# Settings, launcher, and shortcuts

Mesh-client settings are split between the always-visible **App** tab (this computer) and protocol **Device** panels such as **Radio** (the connected companion). This guide covers where each kind of setting lives, the Ctrl/Cmd+K launcher and pins, App and Radio groups at a glance, keyboard shortcuts verified in source, contact groups on all three protocols, and data/storage. Specialized topics link out rather than duplicating full guides.

---

## Where settings live

| Surface                         | What it controls                                                                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **App**                         | Global preferences: protocols on/off, GPS, map filters, retention, window, updates, appearance, notifications, translation, AI summaries, MECP, export, danger zone |
| **Device → Radio**              | Identity, LoRa, channels, position, power/WiFi/display (Meshtastic), MeshCore flood scope / companion CLI, device actions                                           |
| **Device → Connection**         | How you connect (BLE, serial, TCP/HTTP, MQTT) and auto-connect                                                                                                      |
| **Modules / Repeaters / Admin** | Protocol-specific device features — see [Meshtastic](meshtastic.md) and [MeshCore](meshcore.md)                                                                     |
| **Network** (Reticulum)         | Stack identity, interfaces, RMAP, propagation — see [Reticulum](reticulum.md)                                                                                       |

Per-conversation mute, pins, and archive live in **Chat**, not App. Radio Apply buttons stay disabled until that config slice has been read from the device so defaults cannot overwrite live settings.

---

## Launcher and settings search

Press **Ctrl+K** (Windows/Linux) or **Cmd+K** (macOS) for **All panels**. Search panels, contacts, channels, and individual settings for the **active** protocol.

- Choosing a **panel** opens it.
- Choosing a **setting** opens its panel, expands any collapsed section, scrolls the row into view, flashes it, focuses the first control, and announces the jump.
- Settings for other protocols are never listed; connection state does not hide the active protocol’s settings.

**Pins** (up to four, shared across protocols, none by default):

| Shortcut                        | Action                                         |
| ------------------------------- | ---------------------------------------------- |
| **Ctrl/Cmd+P** in the launcher  | Pin or unpin the focused panel result          |
| **Ctrl/Cmd+1** … **Ctrl/Cmd+4** | Open pinned panel 1–4 (also shown on the rail) |

Pin limit and hints use the launcher copy (**Up to {{max}} panels can be pinned**). Internals: [Settings search (developer)](development/settings-search.md). Shell keyboard rules: [Style guide — Keyboard](style-guide.md#keyboard).

---

## App tab groups

One-liners for each **App Settings** collapsible (and the MECP / Translation / AI blocks mounted with them):

| Group                         | What it is for                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| **Protocols**                 | Enable or hide Meshtastic, MeshCore, and Reticulum on the switcher                     |
| **Log panel**                 | Show the live log stream on the right                                                  |
| **Flood Advert**              | MeshCore scheduled flood / zero-hop advert while connected                             |
| **GPS / Location**            | Share my location, refresh interval, coordinate format, saved locations                |
| **Map & Node Filtering**      | Distance filter, hide MQTT-only, movement paths, position history window               |
| **Retention & limits**        | Startup prune/caps for nodes, contacts, messages, RRC history, destinations            |
| **Window**                    | Close to system tray; keep computer awake while connected                              |
| **Updates**                   | Download updates automatically                                                         |
| **Appearance**                | Theme, colors, font size, reduce motion, 24-hour time, compact messages                |
| **Notifications**             | Sound, chat policy, notification tones, operational alerts, RRC unread                 |
| **Translation**               | Offline packs and optional LibreTranslate                                              |
| **AI conversation summaries** | Opt-in Catch up engines (off by default); see [Catch up](ai-catch-up.md)               |
| **Data Management**           | Export / import-merge database; support bundles for GitHub or developer                |
| **MECP**                      | Chat buttons, Incident Command station, blocked senders, audit export, bridge          |
| **Danger Zone**               | Destructive clears (diagnostics, GPS, nodes, messages, MeshCore/Reticulum, everything) |

---

## Radio tab groups

**Radio Configuration** sections depend on the active protocol and what the device has loaded.

**Shared / common**

- **Device User / Identity** — name and node identity fields the radio accepts
- **LoRa / Radio** — region, modem, frequency parameters
- **TX Power** — when the stack exposes a power control
- **Position / GPS** — fixed / advertised position (MeshCore is advert lat/lon only)
- **Channels** — Meshtastic channel slots or **Channels (MeshCore)** with PSK / hashtag derive
- **Device Actions** / **Device Commands** — Flood Advert, Sync Clock, reboot and related actions
- **Danger Zone** — factory / NodeDB style resets where the protocol supports them

**Meshtastic-oriented**

- **Device Role**, **Power**, **WiFi / Network**, **Display**, **Bluetooth**
- **XMODEM file transfer** — local serial/USB only
- Full module configuration lives on the **Modules** tab — see [Meshtastic](meshtastic.md)

**MeshCore-oriented**

- **Regional flood scope** — radio-wide default hashtag (Chat can override per view)
- Contact management / offload when the radio contact table is full
- Companion CLI settings (firmware that reports protocol version 14+) — see [MeshCore](meshcore.md)

Reticulum does not use this Radio panel; stack settings are under **Network**.

---

## Keyboard shortcuts

Modifier is **Cmd** on macOS and **Ctrl** on Windows/Linux (`formatShortcut` in the launcher helpers). Verified in `App.tsx`, `PanelLauncher`, `globalMessageSearch`, `unifiedInbox`, and chat macro hooks:

| Shortcut                        | Action                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| **Ctrl/Cmd+K**                  | Open or close the panel launcher                                       |
| **Ctrl/Cmd+1** … **Ctrl/Cmd+4** | Open pinned panel 1–4                                                  |
| **Ctrl/Cmd+P**                  | Pin or unpin the focused launcher panel (launcher open)                |
| **Ctrl/Cmd+Shift+F**            | Global message search (cross-protocol FTS)                             |
| **Ctrl/Cmd+Shift+U**            | Unified inbox of received messages                                     |
| **F1**–**F12**                  | Chat composer macros (plain F-keys only; any modifier ignores the key) |
| **Esc**                         | Close launcher, menu, or dialog                                        |
| Arrow keys, **Home**, **End**   | Move within tablists, segmented controls, and menus                    |
| **↑** / **↓** in the launcher   | Move between results                                                   |
| **Enter** in the launcher       | Open the focused or first result                                       |

Macros insert or send the slot text in the visible Chat composer (editable under the composer macro bar). Global search and inbox are toggles from anywhere the window has focus. More Chat behaviour: [Chat](chat.md).

---

## Contact groups

User-managed **Contact Groups** work on **Meshtastic**, **MeshCore**, and **Reticulum** (`hasUserManagedContactGroups`). Open **Manage contact groups** from the Nodes / Contacts / Peers toolbar (All list). Create, rename, delete groups and add or remove members. Creating a group needs a known self node id — connect a radio (or start the Reticulum stack) first.

**Built-in filters** (not editable groups):

| Protocol   | Built-ins                                                                 |
| ---------- | ------------------------------------------------------------------------- |
| Meshtastic | **GPS**, **RF+MQTT**, **Router**                                          |
| MeshCore   | **Type: Chat**, **Type: Repeater**, **Type: Room** (contact `hw_model`)   |
| Reticulum  | Custom groups only on the Contacts-oriented list; Peers tabs are separate |

Filtering by group is display-only — membership does not change the radio contact table by itself.

---

## Data and storage

| Kind                                                       | Where it lives                        | How operators touch it                                                                 |
| ---------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Messages, nodes, contacts                                  | SQLite (`mesh-client.db` in userData) | **Export Database** / **Import & Merge**; Danger Zone clears                           |
| Low-stakes UI prefs                                        | localStorage (renderer)               | Appearance, many App toggles; reset by clearing site data only in extreme recovery     |
| Secrets (MQTT, room/repeater passwords, MeshCore identity) | OS keyring via main                   | Re-enter if the keyring is unavailable; App offers recovery for unreadable credentials |
| Tile cache                                                 | `tile-cache/` under userData          | Map → Offline maps → **Clear tile cache**                                              |
| MECP audit                                                 | `mecp-received.log`                   | **App → MECP → Export MECP log**                                                       |

**Export for GitHub** is the public-safe support zip. **Export for Developer** includes the database and MECP audit — share privately only. Database schema mismatches and “directory not writable” cases: [Troubleshooting — Database and local data](troubleshooting.md#database-and-local-data). Persistence map for developers: [Renderer storage](development/renderer-storage.md).

---

## Related

- [Notification sounds](notification-sounds.md)
- [Localization](localization.md)
- [Accessibility checklist](accessibility-checklist.md)
- [Key backup and crypto](key-backup-and-crypto.md)
- [Chat](chat.md) — search, inbox, macros in context
- [Maps](maps.md) — GPS on the map and offline tiles
- [EMCOMM](emcomm.md) — MECP App settings in operational context
- [Style guide — Keyboard](style-guide.md#keyboard)
