# Credits

## Authors

**[Joey (NV0N)](https://github.com/rinchen)** created the original [Meshtastic Mac Client](https://github.com/Colorado-Mesh/meshtastic_mac_client): a Python/PyQt6 desktop app for macOS. Driven by the lack of native, BLE-capable options for macOS, Joey initially shared the tool with the Colorado Meshtastic community. As interest grew, he matured the app by integrating MeshCore and Reticulum support to meet expanding user needs.

**[dude.eth](https://github.com/defidude)** ported the concept to Electron, enabling cross-platform support across Mac, Linux, and Windows.

### Contributors

- megabear - KD5IHC created the icon
- [Soord](https://github.com/soord)
- [WB3IHY](https://github.com/WB3IHY)
- [Letark](https://github.com/Letark) - Apple code signing & notarization CI
- FuzzyChaos (ADL) - Donation for devices

## Colorado Mesh

Thanks to the [Colorado Mesh](https://coloradomesh.org) community for fostering open-source Meshtastic, MeshCore, and Reticulum development in Colorado.

## Acknowledgements

We were inspired by features from these projects:

- [Meshtastic](https://github.com/meshtastic): Open-source, off-grid mesh communication ecosystem
- [MeshCore](https://github.com/meshcore-dev): Lightweight hybrid routing mesh protocol for packet radios
- [Reticulum](https://reticulum.network/): Cryptographic mesh networking stack; mesh-client integrates via rsReticulum/rsLXMF sidecar
- [meshcore-open](https://github.com/zjs81/meshcore-open): Flutter client for MeshCore devices
- [meshtastic-cli](https://github.com/statico/meshtastic-cli): Terminal UI for monitoring Meshtastic mesh networks
- [Mesh Monitor](https://meshmonitor.org/): Web-based mesh network monitoring dashboard
- [CoreScope](https://github.com/Kpa-clawbot/CoreScope): Self-hosted MeshCore network analyzer with RF analytics, packet visualization, and topology tools
- [Ratspeak](https://github.com/ratspeak/Ratspeak): Primary reference for the Reticulum/rsReticulum/rsLXMF stack, sidecar IPC patterns, and peer interop ([rsReticulum](https://github.com/ratspeak/rsReticulum), [rsLXMF](https://github.com/ratspeak/rsLXMF))

### Bundled binaries

| Binary                  | License  | Role                                                                                     |
| ----------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `mesh-client-reticulum` | AGPL-3.0 | Spawned Reticulum/LXMF sidecar (separate process; see [docs/reticulum.md](reticulum.md)) |

### Bundled fonts

| Font / file                                                         | License | Role                                                                                                                  |
| ------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `MeshClientNomadMono.woff2` (JetBrains Mono Nerd Font Mono, subset) | OFL-1.1 | Nomad Micron viewer monospace + Nerd/FA PUA icons ([OFL](../src/renderer/assets/fonts/OFL-JetBrainsMonoNerdFont.txt)) |

### Vendored

| Source / file      | License | Role                                |
| ------------------ | ------- | ----------------------------------- |
| `micron-parser-js` | MIT     | Nomad Micron (.mu) → HTML (RFnexus) |

## Third-party licenses

npm runtime and development dependency licenses are generated from `package.json` in [third-party-licenses.md](third-party-licenses.md). Transitive licenses are gated by `pnpm run check:licenses`.
