import Foundation
import HuggingFace
import MLXHuggingFace
import MLXLLM
import MLXLMCommon
import Tokenizers

struct Request: Decodable {
  let type: String
  let requestId: String?
  let system: String?
  let user: String?
  let maxTokens: Int?
  let modelPath: String?
}

actor Engine {
  var jobs: [String: Task<Void, Never>] = [:]
  var loadedPath: String?
  var container: ModelContainer?

  func emit(_ value: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: value),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
    fflush(stdout)
  }

  func ensureModel(path: String) async throws -> ModelContainer {
    if loadedPath == path, let container { return container }
    let url = URL(fileURLWithPath: path, isDirectory: true)
    let configuration = ModelConfiguration(directory: url)
    let next = try await LLMModelFactory.shared.loadContainer(
      from: #hubDownloader(),
      using: #huggingFaceTokenizerLoader(),
      configuration: configuration
    )
    container = next
    loadedPath = path
    return next
  }

  func handle(_ request: Request) {
    if request.type == "probe" {
      // Binary presence + MLX import is enough; weights are verified by the app.
      emit(["type": "probe", "available": true, "modelLabel": "MLX"])
      return
    }
    guard let id = request.requestId else { return }
    if request.type == "cancel" {
      jobs[id]?.cancel()
      return
    }
    guard request.type == "generate", jobs.isEmpty,
          let system = request.system, let user = request.user,
          let modelPath = request.modelPath,
          user.utf8.count <= 64 * 1024 else {
      emit(["type": "error", "requestId": id, "reason": "busy"])
      return
    }
    let maxTokens = min(512, max(1, request.maxTokens ?? 250))
    // Soft /no_think for Qwen3 when the chat template ignores enable_thinking.
    let prompt = user.contains("/no_think") ? user : "\(user)\n/no_think"
    jobs[id] = Task {
      defer { jobs.removeValue(forKey: id) }
      do {
        let model = try await ensureModel(path: modelPath)
        try Task.checkCancellation()
        let session = ChatSession(
          model,
          instructions: system,
          generateParameters: GenerateParameters(
            maxTokens: maxTokens,
            temperature: 0.2,
            topP: 0.9
          ),
          additionalContext: ["enable_thinking": false]
        )
        for try await fragment in session.streamResponse(to: prompt) {
          try Task.checkCancellation()
          if !fragment.isEmpty {
            emit(["type": "delta", "requestId": id, "text": fragment])
          }
        }
        try Task.checkCancellation()
        emit(["type": "done", "requestId": id])
      } catch {
        emit([
          "type": "error",
          "requestId": id,
          "reason": Task.isCancelled ? "cancelled" : "error",
        ])
      }
    }
  }

  func stop() {
    for job in jobs.values { job.cancel() }
    container = nil
    loadedPath = nil
  }
}

@main
struct Main {
  static func main() async {
    let engine = Engine()
    await engine.emit(["type": "ready"])
    while let line = readLine() {
      guard line.utf8.count <= 128 * 1024,
            let data = line.data(using: .utf8),
            let request = try? JSONDecoder().decode(Request.self, from: data) else { continue }
      await engine.handle(request)
    }
    await engine.stop()
  }
}
