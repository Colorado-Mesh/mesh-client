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
- [M3SHGH0ST](https://github.com/cj-vana)
- [M0Rf30](https://github.com/M0Rf30) - Flatpak Electron packaging
- [ashortgrayble](https://github.com/ashortgrayble) - Colorado Mesh style guide (color scales, type, radius and elevation)

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
- [MECP](https://mecp.radio/) ([GitHub](https://github.com/xiang-dev-1/MECP)): Mesh Emergency Communication Protocol — structured emergency text for LoRa mesh (engine GPLv3; language packs CC BY 4.0)
- [MeshCoreTracker](https://github.com/CopIXus/MeshCoreTracker): GPS tracker firmware for MeshCore radios; inspired parsing of compact tracker-fix messages (`!MT1`) with role tags and rename-safe, identity-based TAK marker IDs
- [MeshcoreToTAK](https://github.com/CopIXus/MeshcoreToTAK): MeshCore-to-TAK gateway firmware; inspired role-based CoT styling, ordered unit-name filters, MeshCore channel to TAK GeoChat mirroring, and MIL-STD-2525 contact symbology

### Bundled binaries

Application source (Electron main / preload / renderer) is **GPL-3.0-or-later**; see [docs/license.md](license.md).

| Binary                  | License           | Role                                                                                     |
| ----------------------- | ----------------- | ---------------------------------------------------------------------------------------- |
| `mesh-client-reticulum` | AGPL-3.0-or-later | Spawned Reticulum/LXMF sidecar (separate process; see [docs/reticulum.md](reticulum.md)) |

### Bundled fonts

| Font / file                                                                                                                 | License         | Role                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MeshClientNomadMono.woff2` (JetBrains Mono Nerd Font Mono, subset)                                                         | OFL-1.1         | Nomad Micron viewer monospace + Nerd/FA PUA icons ([OFL](../src/renderer/assets/fonts/OFL-JetBrainsMonoNerdFont.txt))                                |
| `assets/fonts/plex/*.woff2` (IBM Plex Sans and IBM Plex Mono, latin, latin-ext and cyrillic subsets, from Fontsource 5.3.0) | OFL-1.1         | App UI typeface, bundled so it works offline ([OFL](../src/renderer/assets/fonts/plex/OFL-IBMPlex.txt))                                              |
| `emoji-picker-element-data` (dev dependency; its English data, built from emojibase-data 17.0.0, is bundled at build time)  | Apache-2.0, MIT | Linux emoji picker data, bundled so it works offline instead of loading from a CDN ([licenses](../src/renderer/assets/emoji/LICENSE-emoji-data.txt)) |

### Vendored

| Source / file                                                                             | License   | Role                                                                                      |
| ----------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `micron-parser-js`                                                                        | MIT       | Nomad Micron (.mu) → HTML (RFnexus)                                                       |
| `src/renderer/lib/mecp/engine/` ([xiang-dev-1/MECP](https://github.com/xiang-dev-1/MECP)) | GPLv3     | MECP encode/decode engine                                                                 |
| `src/renderer/lib/mecp/languages/*.json`                                                  | CC BY 4.0 | MECP localized code/category strings (see upstream `LICENSE-LANGUAGES`)                   |
| `resources/geo/cities15000.tsv` ([GeoNames](https://www.geonames.org/))                   | CC BY 4.0 | Offline place lookup for weather forecasts on the map (`scripts/build-geo-gazetteer.mjs`) |

### Chat translation

The statically bundled Mozilla Bergamot JavaScript loader is MPL-2.0; its modified source,
upstream revisions and checksums are in [the vendor notes](../src/main/translation/vendor/README.md),
with the [MPL-2.0 notice](../src/main/translation/vendor/LICENSE-MPL-2.0.txt).
The fastText loader/code is MIT ([license](../src/main/translation/vendor/LICENSE-fastText.txt)).
These loaders are the only third-party translation code shipped in the installer.

After explicit opt-in, the app downloads Mozilla's Bergamot WASM and translation models
([mozilla/translations](https://github.com/mozilla/translations), MPL-2.0), fastText WASM
(MIT), and the fastText `lid.176.ftz` language-identification model. The latter is trained on
Wikipedia, Tatoeba and SETimes and is **CC-BY-SA-3.0**; see
[fastText's model attribution](https://fasttext.cc/docs/en/language-identification.html) and
[the license](https://creativecommons.org/licenses/by-sa/3.0/).
The identification data is used unchanged; translation models are decompressed without
modifying their data. No model, vocabulary, language-ID file or translation WASM is bundled.

## Third-party licenses

npm runtime and development dependency licenses are generated from `package.json` in [third-party-licenses.md](third-party-licenses.md). Transitive licenses are gated by `pnpm run check:licenses`.
