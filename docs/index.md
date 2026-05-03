# Mesh-Client

Cross-platform **Electron** desktop client for **Meshtastic** and **MeshCore**
on **macOS**, **Linux**, and **Windows** with **BLE**, **USB serial**, **Wi‑Fi/TCP**,
**MQTT**, local **SQLite** history, **routing diagnostics**, and **keyboard-first**
workflows.

This page is the docs landing view based on the project README. For the full
repository version, see [README on GitHub](https://github.com/Colorado-Mesh/mesh-client/blob/main/README.md).

---

## Why

Mesh-Client provides one desktop workflow for both Meshtastic and MeshCore
with persistent local storage, keyboard-first UX, and protocol-specific
diagnostic tooling.

Key outcomes:

- True message persistence with SQLite-backed history.
- Unified interface across Meshtastic and MeshCore.
- Advanced mesh visibility via diagnostics, map overlays, and routing insights.
- Cross-platform desktop support for macOS, Linux, and Windows.

---

## Visuals

![Nodes](images/nodes.png)
![Map](images/map.png)
![Diagnostics](images/diagnostics.png)

---

## Quick Start

Pre-built binaries are available in [GitHub Releases](https://github.com/Colorado-Mesh/mesh-client/releases).

For development setup and local build/test workflow, see:

- [Development Guide](development-environment.md)
- [Troubleshooting](troubleshooting.md)
- [Contributing](contributing.md)

---

## Docs Guide

- **Engineering**
  - [Development Guide](development-environment.md)
  - [Accessibility Checklist](accessibility-checklist.md)
  - [Contributing](contributing.md)
- **MeshCore Roadmap**
  - [Feature Parity](meshcore-meshtastic-parity.md)
  - [MQTT Auth](letsmesh-mqtt-auth.md)
- **Support**
  - [Diagnostics](diagnostics.md)
  - [Troubleshooting](troubleshooting.md)
  - [Meshtastic: mesh vs local client telemetry](meshtastic-telemetry-local-client.md)
- **Project**
  - [License](license.md)
  - [Credits](credits.md)

---

## Frequently Asked Questions

### Is there a way to add a hashtag channel?

Yes. When adding or editing a channel in the **Radio** tab, click **"Derive from name"** and make sure the channel name includes the `#` prefix (e.g., `#general`). This generates the PSK from the SHA-256 hash of the name with the leading `#`.
