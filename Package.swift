// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "MeshAi",
    platforms: [.macOS("26.0")],
    products: [
        .executable(name: "MeshAi", targets: ["MeshAi"]),
    ],
    targets: [
        // CodeQL default-setup Swift autobuild only discovers a package/Xcode
        // project at the repo root (nested Package.swift is invisible to it).
        // Production packaging still uses scripts/build-ai-helper.mjs (swiftc + lipo).
        .executableTarget(
            name: "MeshAi",
            path: "native/ai/apple",
            exclude: [".build"],
            sources: ["main.swift"]
        ),
    ]
)
