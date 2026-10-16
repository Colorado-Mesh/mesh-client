# OS AI helper staging

Run `node scripts/build-ai-helper.mjs` on macOS (Xcode 26+) or Windows (.NET 8+).
Builds are staged here and excluded from Git. Apple helpers are copied as extra resources by
electron-builder when present; missing Apple helpers warn and leave OS AI unavailable.
Windows helpers are compiled by native validation CI but excluded from current NSIS installers
because they lack package identity. Stale binaries are cleared before packaging on every platform.
The macOS helper is universal; it is unavailable on older macOS or ineligible hardware.
Windows requires Microsoft-issued `AiLafToken` and `AiLafAttestation` MSBuild properties,
a supported package identity and the `systemAIModels` capability. Without those, the helper
reports unavailable. Probes never request model installation or download.
Linux has no built-in OS AI API. All platforms can use downloaded models or endpoint engines.
