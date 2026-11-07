// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "MeshAiMlx",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "mesh-ai-mlx", targets: ["MeshAiMlx"]),
  ],
  dependencies: [
    .package(url: "https://github.com/ml-explore/mlx-swift-lm", .upToNextMinor(from: "3.32.3")),
    .package(url: "https://github.com/huggingface/swift-huggingface", from: "0.9.0"),
    .package(url: "https://github.com/huggingface/swift-transformers", from: "1.3.0"),
  ],
  targets: [
    .executableTarget(
      name: "MeshAiMlx",
      dependencies: [
        .product(name: "MLXLLM", package: "mlx-swift-lm"),
        .product(name: "MLXLMCommon", package: "mlx-swift-lm"),
        .product(name: "MLXHuggingFace", package: "mlx-swift-lm"),
        .product(name: "HuggingFace", package: "swift-huggingface"),
        .product(name: "Tokenizers", package: "swift-transformers"),
      ],
      path: "Sources/MeshAiMlx",
    ),
  ],
)
