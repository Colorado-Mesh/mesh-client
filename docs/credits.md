# Credits

## Authors

**[Joey (NV0N)](https://github.com/rinchen)** created the original [Meshtastic Mac Client](https://github.com/Colorado-Mesh/meshtastic_mac_client): a Python/PyQt6 desktop app for macOS. Driven by the lack of native, BLE-capable options for macOS, Joey initially shared the tool with the Colorado Meshtastic community. As interest grew, he matured the app by integrating Meshcore support to meet expanding user needs.

**[dude.eth](https://github.com/defidude)** ported the concept to Electron, enabling cross-platform support across Mac, Linux, and Windows.

### Contributors

- megabear - KD5IHC created the icon
- [Soord](https://github.com/soord)

## Colorado Mesh

Thanks to the [Colorado Mesh](https://coloradomesh.org) community for fostering open-source Meshtastic and MeshCore development in Colorado.

## Acknowledgements

We were inspired by features from these projects:

- [Meshtastic](https://github.com/meshtastic): Open-source, off-grid mesh communication ecosystem
- [MeshCore](https://github.com/meshcore-dev): Lightweight hybrid routing mesh protocol for packet radios
- [meshcore-open](https://github.com/zjs81/meshcore-open): Flutter client for MeshCore devices
- [meshtastic-cli](https://github.com/statico/meshtastic-cli): Terminal UI for monitoring Meshtastic mesh networks
- [Mesh Monitor](https://meshmonitor.org/): Web-based mesh network monitoring dashboard

## Libraries & Tools

Exact semver ranges live in [`package.json`](https://github.com/Colorado-Mesh/mesh-client/blob/main/package.json) at the repository root; the tables below mirror them for attribution.

### Runtime dependencies

| Package               | Version                                  | License      | Description                     |
| --------------------- | ---------------------------------------- | ------------ | ------------------------------- |
| @bufbuild/protobuf    | ^2.11.0                                  | Apache-2.0   | Protocol Buffers implementation |
| @meshtastic/protobufs | npm:@jsr/meshtastic\_\_protobufs@^2.7.20 | Apache-2.0   | Meshtastic protocol definitions |
| @stoprocent/noble     | ^2.4.0                                   | MIT          | BLE (Bluetooth) interface       |
| electron-updater      | ^6.8.3                                   | MIT          | Auto-updates for Electron       |
| jszip                 | ^3.10.1                                  | MIT          | ZIP file handling               |
| mgrs                  | ^2.1.0                                   | MIT          | Military Grid Reference System  |
| mqtt                  | ^5.15.1                                  | EPL-2.0      | MQTT client                     |
| node-forge            | ^1.4.0                                   | BSD-3-Clause | Crypto utilities                |
| systeminformation     | ^5.31.5                                  | MIT          | System info gathering           |

### Development dependencies

| Package                          | Version                                            | License    | Description                      |
| -------------------------------- | -------------------------------------------------- | ---------- | -------------------------------- |
| @axe-core/react                  | ^4.11.2                                            | MIT        | Accessibility testing            |
| @eslint/js                       | ^10.0.1                                            | MIT        | ESLint flat-config helpers       |
| @liamcottle/meshcore.js          | ^1.13.0                                            | MIT        | MeshCore JS library              |
| @meshtastic/core                 | npm:@jsr/meshtastic\_\_core@^2.6.6                 | Apache-2.0 | Meshtastic core                  |
| @meshtastic/transport-http       | npm:@jsr/meshtastic\_\_transport-http@^0.2.1       | Apache-2.0 | HTTP transport                   |
| @meshtastic/transport-web-serial | npm:@jsr/meshtastic\_\_transport-web-serial@^0.2.5 | Apache-2.0 | Web Serial transport             |
| @michaelhart/meshcore-decoder    | ^0.3.0                                             | MIT        | MeshCore decoder                 |
| @tailwindcss/postcss             | ^4.2.2                                             | MIT        | Tailwind CSS for PostCSS         |
| @tanstack/react-virtual          | ^3.13.24                                           | MIT        | Virtual scrolling for React      |
| @testing-library/jest-dom        | ^6.9.1                                             | MIT        | Jest DOM matchers                |
| @testing-library/react           | ^16.3.2                                            | MIT        | React testing utilities          |
| @testing-library/user-event      | ^14.6.1                                            | MIT        | User event simulation            |
| @types/leaflet                   | ^1.9.21                                            | ISC        | TypeScript types for Leaflet     |
| @types/node                      | ^24.12.2                                           | MIT        | TypeScript types for Node.js     |
| @types/node-forge                | ^1.3.14                                            | MIT        | TypeScript types for node-forge  |
| @types/react                     | ^19.2.14                                           | MIT        | TypeScript types for React       |
| @types/react-dom                 | ^19.2.3                                            | MIT        | TypeScript types for React DOM   |
| @typescript-eslint/eslint-plugin | ^8.58.2                                            | MIT        | ESLint TypeScript plugin         |
| @typescript-eslint/parser        | ^8.58.2                                            | MIT        | ESLint TypeScript parser         |
| @vitejs/plugin-react             | ^6.0.1                                             | MIT        | Vite React plugin                |
| concurrently                     | ^9.2.1                                             | MIT        | Run multiple commands            |
| electron                         | ^41.2.1                                            | MIT        | Desktop app framework            |
| electron-builder                 | ^26.8.1                                            | MIT        | Electron app packaging           |
| esbuild                          | ^0.28.0                                            | MIT        | Bundler                          |
| eslint                           | ^10.2.1                                            | MIT        | Linter                           |
| eslint-config-prettier           | ^10.1.8                                            | MIT        | Prettier ESLint config           |
| eslint-plugin-electron           | ^7.0.0                                             | MIT        | ESLint Electron rules            |
| eslint-plugin-import             | ^2.32.0                                            | MIT        | ESLint import rules              |
| eslint-plugin-jsx-a11y           | ^6.10.2                                            | MIT        | ESLint JSX accessibility         |
| eslint-plugin-no-secrets         | ^2.3.3                                             | MIT        | Detect hardcoded secrets         |
| eslint-plugin-prettier           | ^5.5.5                                             | MIT        | ESLint Prettier integration      |
| eslint-plugin-react              | ^7.37.5                                            | MIT        | ESLint React rules               |
| eslint-plugin-react-hooks        | ^7.1.1                                             | MIT        | ESLint React hooks               |
| eslint-plugin-security           | ^4.0.0                                             | MIT        | ESLint security rules            |
| eslint-plugin-simple-import-sort | ^13.0.0                                            | MIT        | ESLint import sorting            |
| jsdom                            | ^29.0.2                                            | MIT        | DOM for Node.js                  |
| leaflet                          | ^1.9.4                                             | ISC        | Interactive maps                 |
| license-checker-rseidelsohn      | ^4.4.2                                             | MIT        | License checking                 |
| markdownlint-cli2                | ^0.22.0                                            | MIT        | Markdown linting                 |
| postcss                          | ^8.5.10                                            | MIT        | CSS processing                   |
| prettier                         | ^3.8.3                                             | MIT        | Code formatter                   |
| prettier-plugin-sh               | ^0.18.1                                            | MIT        | Prettier shell script support    |
| prettier-plugin-tailwindcss      | ^0.7.2                                             | MIT        | Prettier Tailwind class ordering |
| react                            | ^19.2.5                                            | MIT        | UI framework                     |
| react-dom                        | ^19.2.5                                            | MIT        | React DOM renderer               |
| react-leaflet                    | ^5.0.0                                             | ISC        | React Leaflet integration        |
| recharts                         | ^3.8.1                                             | MIT        | Charting library                 |
| sort-package-json                | ^3.6.1                                             | MIT        | Sort package.json                |
| tailwindcss                      | ^4.2.2                                             | MIT        | CSS framework                    |
| typescript                       | ^6.0.3                                             | Apache-2.0 | Type checking                    |
| typescript-eslint                | ^8.58.2                                            | MIT        | ESLint flat-config helper        |
| vite                             | ^8.0.8                                             | MIT        | Build tool                       |
| vitest                           | ^4.1.4                                             | MIT        | Testing framework                |
| vitest-axe                       | 1.0.0-pre.5                                        | MIT        | Vitest accessibility testing     |
| zustand                          | ^5.0.12                                            | MIT        | State management                 |
