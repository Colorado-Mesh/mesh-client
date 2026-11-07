# OS AI / MLX helper staging

Run `node scripts/build-ai-helper.mjs` on macOS (Xcode 26+) or Windows (.NET 8+).
Builds are staged here and excluded from Git. Apple helpers are copied as extra resources by
electron-builder when present; missing Apple helpers warn and leave OS AI unavailable.
On Apple Silicon Macs the same script also builds optional `mesh-ai-mlx` (SwiftPM + mlx-swift-lm)
for Metal Catch up; that build needs full **Xcode** (Metal via `xcrun` — Command Line Tools
alone fail). Staging copies `mesh-ai-mlx` **and** adjacent SwiftPM bundles (`mlx-swift_Cmlx.bundle`
with `default.metallib`, plus Hub/Crypto bundles). Copying only the binary causes Catch up to fail
with a generic summarize error (“Failed to load the default metallib”). A failed MLX build warns
and leaves MLX catalog models unavailable without blocking the Foundation Models helper. Windows
helpers are compiled by native validation CI but excluded from current NSIS installers because they
lack package identity. Stale binaries are cleared before packaging on every platform. The macOS
Foundation Models helper is universal; it is unavailable on older macOS or ineligible hardware.
`mesh-ai-mlx` is arm64-only.
Windows requires Microsoft-issued `AiLafToken` and `AiLafAttestation` MSBuild properties,
a supported package identity and the `systemAIModels` capability. Without those, the helper
reports unavailable. Probes never request model installation or download.
Linux has no built-in OS AI API. All platforms can use downloaded models or endpoint engines.
