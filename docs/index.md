---
hide:
  - navigation
---

# Mesh-Client

**One desktop app for Meshtastic, MeshCore, and Reticulum mesh networks** on macOS, Linux, and Windows. Connect over Bluetooth, USB serial, Wi-Fi/TCP, or MQTT, keep your full message history locally, and see what your mesh is actually doing with built-in routing diagnostics.

[Download Mesh-Client](https://github.com/Colorado-Mesh/mesh-client/releases/latest){ .md-button .md-button--primary }
[Install guide](install.md){ .md-button }
[All features](features.md){ .md-button }

<div class="mesh-hero" markdown>

![Mesh-Client chat view](images/chat.png)

</div>

> [!NOTE]
> **Volunteer-run.** Mesh-Client is designed, coded, tested, translated, documented, and supported entirely by unpaid volunteers. There is no company or paid staff behind it. Bug reports, testing on real radios, translations, docs, and code all help. See [Contributing](contributing.md) or join the [Discord](https://discord.com/invite/McChKR5NpS).

## Pick your mesh

<div class="grid" markdown>

<div class="card protocol-meshtastic" markdown>

### Meshtastic

Connect a Meshtastic radio over BLE, USB serial, HTTP, or TCP, or join over MQTT. Channels, DMs, remote admin, telemetry, Store & Forward, and routing diagnostics.

[Meshtastic features](features.md#meshtastic-features) · [Troubleshooting](troubleshooting.md)

</div>

<div class="card protocol-meshcore" markdown>

### MeshCore

Companion radios over BLE, USB serial, or TCP. Contacts, channels, Rooms (BBS), repeater admin (status, neighbors, trace, CLI), and MQTT chat ingest.

[MeshCore features](features.md#meshcore-features) · [Troubleshooting](troubleshooting-meshcore.md)

</div>

<div class="card protocol-reticulum" markdown>

### Reticulum

A bundled Reticulum stack with TCP, I2P, Auto, and RNode interfaces. LXMF direct messages, RRC hub chat, Nomad Network pages, propagation nodes, Remote shell and file copy, and games.

[First-time setup](reticulum-setup-guide.md) · [User guide](reticulum.md) · [Troubleshooting](troubleshooting-reticulum.md)

</div>

</div>

## Highlights

- **Persistent history:** every message, node, and contact is stored in a local SQLite database, so nothing disappears when you reconnect.
- **Routing diagnostics:** spot problem relays, hidden terminals, noisy channels, and unstable paths. See [Diagnostics](diagnostics.md).
- **Maps that work offline:** download map regions ahead of time for field use. See [Troubleshooting: Map tab without internet](troubleshooting.md#map-tab-without-internet-offline--no-wan).
- **Emergency communications:** MECP emergency reports, Incident Command, and TAK (Cursor-on-Target) on all three protocols. See the [EMCOMM guide](emcomm.md).
- **Your language:** the interface is available in 16 languages and works fully offline. See [Localization](localization.md).

<div class="grid" markdown>

![Nodes list](images/nodes.png)

![Map](images/map.png)

![Diagnostics](images/diagnostics.png)

![Node detail](images/node-detail.png)

![Repeaters](images/repeaters.png)

![MECP emergency compose](images/MECP.png)

![Reticulum peers](images/peers.png)

![Nomad Network](images/nomad.png)

</div>

## Get help

- **Something not working?** Start with [Troubleshooting](troubleshooting.md), or the [MeshCore](troubleshooting-meshcore.md) and [Reticulum](troubleshooting-reticulum.md) pages.
- **Reporting a bug:** use **App → Export for GitHub** and attach the file. See [Reporting bugs](troubleshooting.md#reporting-bugs-export-for-github-app-tab).
- **Unfamiliar term?** Check the [Glossary](glossary.md).
- **Talk to people:** the [Colorado Mesh Discord](https://discord.com/invite/McChKR5NpS) or [GitHub issues](https://github.com/Colorado-Mesh/mesh-client/issues).

## Frequently asked questions

### Is there a way to add a hashtag channel?

Yes. When adding or editing a channel in the **Radio** tab, click **"Derive from name"** and make sure the channel name includes the `#` prefix (e.g., `#general`). This generates the PSK from the SHA-256 hash of the name with the leading `#`.

### How do I use Reticulum?

Select **RN** (Reticulum, yellow) at the top of the rail, open **Connection**, choose **Start stack**, then use **Network** to create or import an identity and add **Interfaces** (TCP, Auto, or RNode). Chat is **DM-only** over LXMF. See the [Reticulum setup guide](reticulum-setup-guide.md) for a walkthrough.

### macOS says the app is damaged or crashes at launch after unzipping

Prefer the **`.dmg`**. If you use the **`.zip`**, extract it with **[Keka](https://www.keka.io/en/)** or `ditto -xk`, not 7-Zip. See [Troubleshooting: Squirrel.framework](troubleshooting.md#macos-library-not-loaded-squirrelframework-after-zip-extract).

## Protocol scope

Mesh-Client focuses on RF mesh (LoRa and related). Additional protocols are in scope when they support that RF mesh path; internet-only stacks are out of scope. Mesh-Client is for everyone, everywhere, not only licensed amateurs. See [README: Why](https://github.com/Colorado-Mesh/mesh-client/blob/main/README.md#why).
