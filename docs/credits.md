# Credits

## Authors

**[Joey (NV0N)](https://github.com/rinchen)** created the original [Meshtastic Mac Client](https://github.com/Colorado-Mesh/meshtastic_mac_client): a Python/PyQt6 desktop app for macOS. Driven by the lack of native, BLE-capable options for macOS, Joey initially shared the tool with the Colorado Meshtastic community. As interest grew, he matured the app by integrating MeshCore and Reticulum support to meet expanding user needs.

**[dude.eth](https://github.com/defidude)** ported the concept to Electron, enabling cross-platform support across Mac, Linux, and Windows.

### Contributors

- megabear - KD5IHC created the icon
- [Soord](https://github.com/soord)
- [WB3IHY](https://github.com/WB3IHY)
- [Letark](https://github.com/Letark) - Apple code signing & notarization CI

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

Exact semver ranges live in [`package.json`](https://github.com/Colorado-Mesh/mesh-client/blob/main/package.json) at the repository root; the tables below mirror them for attribution.

### Runtime dependencies

| Package               | Version                                  | License                 | Description                               |
| --------------------- | ---------------------------------------- | ----------------------- | ----------------------------------------- |
| @bufbuild/protobuf    | ^2.12.1                                  | Apache-2.0              | Protocol Buffers implementation           |
| @meshtastic/protobufs | npm:@jsr/meshtastic\_\_protobufs@^2.7.23 | Apache-2.0              | Meshtastic protocol definitions           |
| @stoprocent/noble     | ^2.5.9                                   | MIT                     | BLE (Bluetooth) interface                 |
| @zip.js/zip.js        | ^2.8.26                                  | BSD-3-Clause            | ZIP streaming and extraction              |
| builder-util-runtime  | 9.7.0                                    | MIT                     | Electron builder runtime utilities        |
| dompurify             | ^3.4.11                                  | MPL-2.0 OR Apache-2.0   | HTML sanitization                         |
| electron-updater      | ^6.8.9                                   | MIT                     | Auto-updates for Electron                 |
| emoji-picker-element  | ^1.29.1                                  | Apache-2.0              | Web component emoji picker (Linux chat)   |
| esptool-js            | 0.4.5                                    | Apache-2.0              | ESP32 firmware flashing (Reticulum RNode) |
| i18next               | ^26.3.4                                  | MIT                     | Internationalization framework            |
| js-md5                | ^0.8.3                                   | MIT                     | MD5 hashing                               |
| jszip                 | ^3.10.1                                  | MIT OR GPL-3.0-or-later | ZIP file handling                         |
| leaflet.markercluster | ^1.5.3                                   | MIT                     | Leaflet marker clustering                 |
| lucide-react-motion   | ^0.4.0                                   | MIT                     | Animated Lucide icons                     |
| mgrs                  | ^2.1.0                                   | MIT                     | Military Grid Reference System            |
| micron-parser-js      | vendored (RFnexus)                       | MIT                     | Nomad Micron (.mu) → HTML                 |
| motion                | ^12.42.2                                 | MIT                     | Animation library                         |
| mqtt                  | ^5.15.1                                  | MIT                     | MQTT client                               |
| node-forge            | ^1.4.0                                   | BSD-3-Clause OR GPL-2.0 | Crypto utilities                          |
| react-i18next         | ^17.0.8                                  | MIT                     | React i18n integration                    |
| react-leaflet-cluster | ^4.1.3                                   | MIT                     | React Leaflet marker clusters             |
| readable-stream       | ^4.7.0                                   | MIT                     | Node.js streams                           |
| semver                | 7.7.4                                    | ISC                     | Semantic versioning                       |
| systeminformation     | ^5.31.12                                 | MIT                     | System info gathering                     |

### Development dependencies

| Package                          | Version                                            | License         | Description                      |
| -------------------------------- | -------------------------------------------------- | --------------- | -------------------------------- |
| @axe-core/react                  | ^4.12.1                                            | MPL-2.0         | Accessibility testing            |
| @eslint/js                       | ^10.0.1                                            | MIT             | ESLint flat-config helpers       |
| @liamcottle/meshcore.js          | ^1.13.0                                            | MIT             | MeshCore JS library              |
| @meshtastic/core                 | npm:@jsr/meshtastic\_\_core@^2.6.6                 | Apache-2.0      | Meshtastic core                  |
| @meshtastic/transport-http       | npm:@jsr/meshtastic\_\_transport-http@^0.2.1       | Apache-2.0      | HTTP transport                   |
| @meshtastic/transport-web-serial | npm:@jsr/meshtastic\_\_transport-web-serial@^0.2.5 | Apache-2.0      | Web Serial transport             |
| @michaelhart/meshcore-decoder    | ^0.3.0                                             | MIT             | MeshCore decoder                 |
| @tailwindcss/postcss             | ^4.3.2                                             | MIT             | Tailwind CSS for PostCSS         |
| @tanstack/react-virtual          | ^3.14.5                                            | MIT             | Virtual scrolling for React      |
| @testing-library/jest-dom        | ^6.9.1                                             | MIT             | Jest DOM matchers                |
| @testing-library/react           | ^16.3.2                                            | MIT             | React testing utilities          |
| @testing-library/user-event      | ^14.6.1                                            | MIT             | User event simulation            |
| @types/js-md5                    | ^0.8.0                                             | MIT             | TypeScript types for js-md5      |
| @types/leaflet                   | ^1.9.21                                            | MIT             | TypeScript types for Leaflet     |
| @types/node                      | ^25.9.4                                            | MIT             | TypeScript types for Node.js     |
| @types/node-forge                | ^1.3.14                                            | MIT             | TypeScript types for node-forge  |
| @types/react                     | ^19.2.17                                           | MIT             | TypeScript types for React       |
| @types/react-dom                 | ^19.2.3                                            | MIT             | TypeScript types for React DOM   |
| @typescript-eslint/eslint-plugin | ^8.62.1                                            | MIT             | ESLint TypeScript plugin         |
| @typescript-eslint/parser        | ^8.62.1                                            | MIT             | ESLint TypeScript parser         |
| @vitejs/plugin-react             | ^6.0.3                                             | MIT             | Vite React plugin                |
| @vitest/coverage-v8              | ^4.1.9                                             | MIT             | Vitest V8 coverage               |
| concurrently                     | ^9.2.3                                             | MIT             | Run multiple commands            |
| electron                         | ^41.9.2                                            | MIT             | Desktop app framework            |
| electron-builder                 | ^26.15.6                                           | MIT             | Electron app packaging           |
| esbuild                          | ^0.28.1                                            | MIT             | Bundler                          |
| eslint                           | ^10.6.0                                            | MIT             | Linter                           |
| eslint-config-prettier           | ^10.1.8                                            | MIT             | Prettier ESLint config           |
| eslint-plugin-electron           | ^7.0.0                                             | ISC             | ESLint Electron rules            |
| eslint-plugin-import             | ^2.32.0                                            | MIT             | ESLint import rules              |
| eslint-plugin-jsx-a11y           | ^6.10.2                                            | MIT             | ESLint JSX accessibility         |
| eslint-plugin-no-secrets         | ^2.3.3                                             | MIT             | Detect hardcoded secrets         |
| eslint-plugin-prettier           | ^5.5.6                                             | MIT             | ESLint Prettier integration      |
| eslint-plugin-react              | ^7.37.5                                            | MIT             | ESLint React rules               |
| eslint-plugin-react-hooks        | ^7.1.1                                             | MIT             | ESLint React hooks               |
| eslint-plugin-security           | ^4.0.1                                             | Apache-2.0      | ESLint security rules            |
| eslint-plugin-simple-import-sort | ^13.0.0                                            | MIT             | ESLint import sorting            |
| jsdom                            | ^29.1.1                                            | MIT             | DOM for Node.js                  |
| leaflet                          | ^1.9.4                                             | BSD-2-Clause    | Interactive maps                 |
| license-checker-rseidelsohn      | ^4.4.2                                             | BSD-3-Clause    | License checking                 |
| markdownlint-cli2                | ^0.22.1                                            | MIT             | Markdown linting                 |
| postcss                          | ^8.5.16                                            | MIT             | CSS processing                   |
| prettier                         | ^3.9.4                                             | MIT             | Code formatter                   |
| prettier-plugin-sh               | ^0.18.1                                            | MIT             | Prettier shell script support    |
| prettier-plugin-tailwindcss      | ^0.7.4                                             | MIT             | Prettier Tailwind class ordering |
| react                            | ^19.2.7                                            | MIT             | UI framework                     |
| react-dom                        | ^19.2.7                                            | MIT             | React DOM renderer               |
| react-leaflet                    | ^5.0.0                                             | Hippocratic-2.1 | React Leaflet integration        |
| recharts                         | ^3.9.2                                             | MIT             | Charting library                 |
| sort-package-json                | ^3.7.1                                             | MIT             | Sort package.json                |
| tailwindcss                      | ^4.3.2                                             | MIT             | CSS framework                    |
| typescript                       | ^6.0.3                                             | Apache-2.0      | Type checking                    |
| typescript-eslint                | ^8.62.1                                            | MIT             | ESLint flat-config helper        |
| vite                             | ^8.1.3                                             | MIT             | Build tool                       |
| vitest                           | ^4.1.9                                             | MIT             | Testing framework                |
| vitest-axe                       | 1.0.0-pre.5                                        | MIT             | Vitest accessibility testing     |
| zustand                          | ^5.0.14                                            | MIT             | State management                 |
