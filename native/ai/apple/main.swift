import Foundation
import FoundationModels

struct Request: Decodable {
    let type: String
    let requestId: String?
    let system: String?
    let user: String?
    let maxTokens: Int?
}

actor Engine {
    var jobs: [String: Task<Void, Never>] = [:]
    func emit(_ value: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: value),
              let line = String(data: data, encoding: .utf8) else { return }
        print(line)
        fflush(stdout)
    }
    func handle(_ request: Request) {
        if request.type == "probe" {
            let available: Bool
            switch SystemLanguageModel.default.availability {
            case .available: available = true
            case .unavailable: available = false
            }
            emit(["type": "probe", "available": available, "modelLabel": "Apple Intelligence"])
            return
        }
        guard let id = request.requestId else { return }
        if request.type == "cancel" { jobs[id]?.cancel(); return }
        guard request.type == "generate", jobs.isEmpty,
              let system = request.system, let user = request.user,
              user.utf8.count <= 64 * 1024 else {
            emit(["type": "error", "requestId": id, "reason": "busy"])
            return
        }
        jobs[id] = Task {
            defer { jobs.removeValue(forKey: id) }
            do {
                let session = LanguageModelSession(model: .default, instructions: system)
                let options = GenerationOptions(temperature: 0.2, maximumResponseTokens: min(250, max(1, request.maxTokens ?? 250)))
                var previous = ""
                for try await snapshot in session.streamResponse(to: user, options: options) {
                    try Task.checkCancellation()
                    let full = snapshot.content
                    guard full.hasPrefix(previous) else { throw CancellationError() }
                    let delta = String(full.dropFirst(previous.count))
                    if !delta.isEmpty { emit(["type": "delta", "requestId": id, "text": delta]) }
                    previous = full
                }
                try Task.checkCancellation()
                emit(["type": "done", "requestId": id])
            } catch {
                // No prompt, model output, or framework error text is logged.
                emit(["type": "error", "requestId": id, "reason": Task.isCancelled ? "cancelled" : "error"])
            }
        }
    }
    func stop() { for job in jobs.values { job.cancel() } }
}

@main struct Main {
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
