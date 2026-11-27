import Capacitor
import Darwin
import Foundation
#if canImport(MeshReticulum)
import MeshReticulum
#endif

/// `MeshProcess` Capacitor plugin: runs the Reticulum sidecar **in process** (iOS apps cannot start
/// executables) and owns the real directory the sidecar and the host share.
///
/// The sidecar is linked only when the `MeshReticulum` Clang module is visible to the App target:
/// `node mobile/scripts/build-sidecar.mjs ios` builds `mobile/ios/App/MeshReticulum.xcframework`
/// (C ABI: `mobile/native/reticulum-ffi/include/mesh_reticulum.h`), then
/// `mobile/ios/scripts/configure-sidecar.sh` writes the gitignored `mobile/ios/mesh-sidecar.xcconfig`
/// that `mobile/ios/mesh.xcconfig` includes. Without it `spawn` rejects with ENOENT and
/// `MeshDevice.getInfo().sidecarAvailable` is false; the shared-directory methods always work.
@objc(MeshProcessPlugin)
public class MeshProcessPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeshProcessPlugin"
    public let jsName = "MeshProcess"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "spawn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "writeStdin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "closeStdin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "kill", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSharedDir", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharedList", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharedRead", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharedWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "sharedRemove", returnType: CAPPluginReturnPromise),
    ]

    /// True when the in-process Reticulum library is linked into this build.
    static var sidecarAvailable: Bool {
        #if canImport(MeshReticulum)
        return true
        #else
        return false
        #endif
    }

    private let queue = DispatchQueue(label: "org.coloradomesh.meshclient.meshprocess")
    private let fileQueue = DispatchQueue(label: "org.coloradomesh.meshclient.meshprocess.files", qos: .userInitiated)
    private var deliveryQueue: DispatchQueue?

    override public func load() {
        deliveryQueue = (bridge as? CapacitorBridge)?.dispatchQueue
    }

    private func deliver(_ block: @escaping () -> Void) {
        (deliveryQueue ?? DispatchQueue.main).async(execute: block)
    }

    private func emit(_ event: String, _ data: [String: Any]) {
        deliver { [weak self] in self?.notifyListeners(event, data: data) }
    }

    // MARK: Shared directory

    @objc func getSharedDir(_ call: CAPPluginCall) {
        fileQueue.async {
            do {
                let root = try MeshSharedDir.root()
                call.resolve(["path": root.path])
            } catch {
                call.reject("EACCES cannot create the shared directory: \(error.localizedDescription)")
            }
        }
    }

    @objc func sharedList(_ call: CAPPluginCall) {
        let relative = call.getString("path") ?? ""
        fileQueue.async {
            do {
                let files = try MeshSharedDir.list(relative)
                call.resolve(["files": files])
            } catch {
                call.reject(MeshNetError.text(error))
            }
        }
    }

    @objc func sharedRead(_ call: CAPPluginCall) {
        let relative = call.getString("path") ?? ""
        fileQueue.async {
            do {
                let data = try MeshSharedDir.read(relative)
                call.resolve(["dataB64": data.base64EncodedString()])
            } catch {
                call.reject(MeshNetError.text(error))
            }
        }
    }

    @objc func sharedWrite(_ call: CAPPluginCall) {
        let relative = call.getString("path") ?? ""
        let base64 = call.getString("dataB64") ?? ""
        fileQueue.async {
            do {
                guard let data = Data(base64Encoded: base64) else {
                    throw MeshNetError("ERR_INVALID_ARG_VALUE dataB64 is not valid base64")
                }
                try MeshSharedDir.write(relative, data: data)
                call.resolve()
            } catch {
                call.reject(MeshNetError.text(error))
            }
        }
    }

    @objc func sharedRemove(_ call: CAPPluginCall) {
        let relative = call.getString("path") ?? ""
        fileQueue.async {
            do {
                try MeshSharedDir.remove(relative)
                call.resolve()
            } catch {
                call.reject(MeshNetError.text(error))
            }
        }
    }

    // MARK: Sidecar

    #if canImport(MeshReticulum)
    /// One `mesh_reticulum_start` instance. Follows the calling sequence in `mesh_reticulum.h`:
    /// the library owns the stdin read end and the output write ends from `start` on; the plugin
    /// owns (and closes) the stdin write end and the output read ends.
    private final class SidecarRun {
        let id: String
        let instance: Int64
        let stdinWrite: Int32
        let writeQueue: DispatchQueue
        var stdinOpen = true
        var sources: [DispatchSourceRead] = []
        var openStreams = 2
        var exitCode: Int32?
        var exited = false

        init(id: String, instance: Int64, stdinWrite: Int32) {
            self.id = id
            self.instance = instance
            self.stdinWrite = stdinWrite
            writeQueue = DispatchQueue(label: "org.coloradomesh.meshclient.meshprocess.stdin.\(id)")
        }

        /// Closes our stdin write end once (write queue only).
        func closeStdin() {
            guard stdinOpen else { return }
            stdinOpen = false
            _ = Darwin.close(stdinWrite)
        }
    }

    /// `mesh_reticulum_wait` result when the instance ended because of `mesh_reticulum_stop`
    /// (MESH_RETICULUM_EXIT_STOPPED).
    private static let exitStopped: Int32 = -15

    private var runs: [String: SidecarRun] = [:]

    @objc func spawn(_ call: CAPPluginCall) {
        queue.async { [self] in
            do {
                try start(call)
            } catch {
                deliver { call.reject(MeshNetError.text(error)) }
            }
        }
    }

    private static func json(_ object: Any) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: object)
        guard let text = String(data: data, encoding: .utf8) else { throw MeshNetError("EINVAL could not encode JSON") }
        return text
    }

    private func start(_ call: CAPPluginCall) throws {
        guard let id = call.getString("id"), !id.isEmpty else { throw MeshNetError("ERR_INVALID_ARG_TYPE missing id") }
        guard runs[id] == nil else { throw MeshNetError("EEXIST process \(id) is already running") }
        // argv without the program name; env as given (the library reads only RUST_LOG).
        let argvJson = try Self.json((call.getArray("args") ?? []).compactMap { $0 as? String })
        var env: [String: String] = [:]
        for (name, value) in call.getObject("env") ?? [:] {
            if let text = value as? String { env[name] = text }
        }
        let envJson = try Self.json(env)

        var stdinPipe: [Int32] = [-1, -1]
        var stdoutPipe: [Int32] = [-1, -1]
        var stderrPipe: [Int32] = [-1, -1]
        guard pipe(&stdinPipe) == 0 else { throw MeshNetError(MeshErrno.message(errno, syscall: "spawn pipe")) }
        guard pipe(&stdoutPipe) == 0 else {
            stdinPipe.forEach { _ = Darwin.close($0) }
            throw MeshNetError(MeshErrno.message(errno, syscall: "spawn pipe"))
        }
        guard pipe(&stderrPipe) == 0 else {
            (stdinPipe + stdoutPipe).forEach { _ = Darwin.close($0) }
            throw MeshNetError(MeshErrno.message(errno, syscall: "spawn pipe"))
        }
        // The library closes the stdin read end after the bootstrap line; a late write must fail
        // with EPIPE instead of raising SIGPIPE in the app.
        _ = fcntl(stdinPipe[1], F_SETNOSIGPIPE, 1)
        for fd in [stdoutPipe[0], stderrPipe[0]] {
            _ = fcntl(fd, F_SETFL, fcntl(fd, F_GETFL) | O_NONBLOCK)
        }

        let instance = argvJson.withCString { argv in
            envJson.withCString { envText in
                mesh_reticulum_start(argv, envText, stdinPipe[0], stdoutPipe[1], stderrPipe[1])
            }
        }
        // From here the library owns stdinPipe[0], stdoutPipe[1] and stderrPipe[1] (also on error).
        guard instance > 0 else {
            [stdinPipe[1], stdoutPipe[0], stderrPipe[0]].forEach { _ = Darwin.close($0) }
            throw MeshNetError("ENOENT spawn reticulum-sidecar ENOENT (mesh_reticulum_start failed: \(instance))")
        }

        let run = SidecarRun(id: id, instance: instance, stdinWrite: stdinPipe[1])
        runs[id] = run
        attachReader(stdoutPipe[0], event: "stdout", run: run)
        attachReader(stderrPipe[0], event: "stderr", run: run)

        // mesh_reticulum_wait blocks until the instance exits; never on the main or bridge queue.
        let waiter = Thread { [weak self] in
            let code = mesh_reticulum_wait(instance)
            self?.queue.async {
                run.exitCode = code
                self?.finishIfDone(run)
            }
        }
        waiter.name = "mesh-reticulum-wait-\(id)"
        waiter.start()
        let pid = Int(instance)
        deliver { call.resolve(["pid": pid]) }
    }

    private func attachReader(_ fd: Int32, event: String, run: SidecarRun) {
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self, weak source] in
            var buffer = [UInt8](repeating: 0, count: 65_536)
            let (count, error) = buffer.withUnsafeMutableBytes { bytes -> (Int, Int32) in
                let n = read(fd, bytes.baseAddress, bytes.count)
                return (n, n < 0 ? errno : 0)
            }
            if count > 0 {
                self?.emit(event, ["id": run.id, "dataB64": Data(buffer[0 ..< count]).base64EncodedString()])
            } else if count == 0 || (error != EAGAIN && error != EINTR) {
                source?.cancel()
            }
        }
        source.setCancelHandler { [weak self] in
            _ = Darwin.close(fd)
            run.openStreams -= 1
            self?.finishIfDone(run)
        }
        run.sources.append(source)
        source.resume()
    }

    /// `exit` after `mesh_reticulum_wait` returned and both output pipes reached EOF, so no
    /// trailing output is lost.
    private func finishIfDone(_ run: SidecarRun) {
        guard !run.exited, let code = run.exitCode, run.openStreams <= 0 else { return }
        run.exited = true
        runs[run.id] = nil
        run.writeQueue.async { run.closeStdin() }
        let stopped = code == Self.exitStopped
        emit("exit", [
            "id": run.id,
            "code": stopped ? NSNull() : NSNumber(value: code),
            "signal": stopped ? "SIGTERM" : NSNull(),
        ])
    }

    @objc func writeStdin(_ call: CAPPluginCall) {
        queue.async { [self] in
            guard let id = call.getString("id"), let run = runs[id] else {
                deliver { call.reject("EPIPE write EPIPE (process is not running)") }
                return
            }
            guard let data = Data(base64Encoded: call.getString("dataB64") ?? "") else {
                deliver { call.reject("ERR_INVALID_ARG_VALUE dataB64 is not valid base64") }
                return
            }
            // Blocking writes run on the instance's own queue, in call order.
            run.writeQueue.async { [weak self] in
                var failure: Int32 = 0
                if !run.stdinOpen {
                    failure = EPIPE
                } else {
                    data.withUnsafeBytes { bytes in
                        var offset = 0
                        while offset < bytes.count, let base = bytes.baseAddress {
                            let n = write(run.stdinWrite, base + offset, bytes.count - offset)
                            if n < 0 {
                                if errno == EINTR { continue }
                                failure = errno
                                return
                            }
                            offset += n
                        }
                    }
                }
                let message = failure == 0 ? nil : MeshErrno.message(failure, syscall: "write")
                self?.deliver {
                    if let message { call.reject(message) } else { call.resolve() }
                }
            }
        }
    }

    @objc func closeStdin(_ call: CAPPluginCall) {
        queue.async { [self] in
            guard let id = call.getString("id"), let run = runs[id] else {
                deliver { call.resolve() }
                return
            }
            run.writeQueue.async { [weak self] in
                run.closeStdin()
                self?.deliver { call.resolve() }
            }
        }
    }

    /// Any signal → `mesh_reticulum_stop` plus closing stdin (a thread cannot be killed); `exit`
    /// follows when the instance has shut down (`signal: "SIGTERM"` when it ended because of it).
    @objc func kill(_ call: CAPPluginCall) {
        queue.async { [self] in
            if let id = call.getString("id"), let run = runs[id] {
                _ = mesh_reticulum_stop(run.instance)
                run.writeQueue.async { run.closeStdin() }
            }
            deliver { call.resolve() }
        }
    }
    #else
    @objc func spawn(_ call: CAPPluginCall) {
        call.reject("ENOENT reticulum sidecar not available on this build")
    }

    @objc func writeStdin(_ call: CAPPluginCall) {
        call.reject("EPIPE write EPIPE (process is not running)")
    }

    @objc func closeStdin(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func kill(_ call: CAPPluginCall) {
        call.resolve()
    }
    #endif
}

/// `<Application Support>/mesh-reticulum`: Reticulum config and storage shared by the host (via
/// `shared*`) and the sidecar (real paths in its arguments). Excluded from iCloud backup (identity
/// keys and caches stay on the device).
enum MeshSharedDir {
    static func root() throws -> URL {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        var dir = support.appendingPathComponent("mesh-reticulum", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try? dir.setResourceValues(values)
        return dir
    }

    /// Normalized relative path; rejects absolute paths outside the shared dir and `..` escapes.
    static func normalize(_ path: String, root: URL) throws -> String {
        var relative = path
        if relative.hasPrefix("/") {
            let rootPath = root.standardizedFileURL.path
            let resolvedRoot = root.resolvingSymlinksInPath().path
            if relative == rootPath || relative == resolvedRoot {
                relative = ""
            } else if relative.hasPrefix(rootPath + "/") {
                relative = String(relative.dropFirst(rootPath.count + 1))
            } else if relative.hasPrefix(resolvedRoot + "/") {
                relative = String(relative.dropFirst(resolvedRoot.count + 1))
            } else {
                throw MeshNetError("EACCES path outside the shared directory: \(path)")
            }
        }
        var parts: [Substring] = []
        for part in relative.split(separator: "/", omittingEmptySubsequences: true) {
            if part == "." { continue }
            if part == ".." { throw MeshNetError("EACCES path escapes the shared directory: \(path)") }
            parts.append(part)
        }
        return parts.joined(separator: "/")
    }

    static func resolve(_ path: String) throws -> (root: URL, relative: String, url: URL) {
        let root = try root()
        let relative = try normalize(path, root: root)
        let url = relative.isEmpty ? root : root.appendingPathComponent(relative)
        // Defence in depth against symlinks planted inside the shared dir.
        let resolvedRoot = root.resolvingSymlinksInPath().path
        let resolved = url.resolvingSymlinksInPath().path
        guard resolved == resolvedRoot || resolved.hasPrefix(resolvedRoot + "/") else {
            throw MeshNetError("EACCES path escapes the shared directory: \(path)")
        }
        return (root, relative, url)
    }

    static func list(_ path: String) throws -> [[String: Any]] {
        let (_, relative, url) = try resolve(path)
        let manager = FileManager.default
        var isDirectory: ObjCBool = false
        guard manager.fileExists(atPath: url.path, isDirectory: &isDirectory) else { return [] }
        func entry(_ fullPath: String, _ relativePath: String) -> [String: Any]? {
            guard let attributes = try? manager.attributesOfItem(atPath: fullPath),
                  attributes[.type] as? FileAttributeType == .typeRegular else { return nil }
            let size = (attributes[.size] as? NSNumber)?.int64Value ?? 0
            let modified = (attributes[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            return ["path": relativePath, "size": size, "mtimeMs": (modified * 1000).rounded()]
        }
        if !isDirectory.boolValue {
            return entry(url.path, relative).map { [$0] } ?? []
        }
        var files: [[String: Any]] = []
        let enumerator = manager.enumerator(atPath: url.path)
        while let child = enumerator?.nextObject() as? String {
            let childRelative = relative.isEmpty ? child : "\(relative)/\(child)"
            if let file = entry(url.appendingPathComponent(child).path, childRelative) { files.append(file) }
        }
        return files
    }

    static func read(_ path: String) throws -> Data {
        let (_, relative, url) = try resolve(path)
        guard !relative.isEmpty, FileManager.default.fileExists(atPath: url.path) else {
            throw MeshNetError("ENOENT no such file or directory, open '\(path)'")
        }
        return try Data(contentsOf: url)
    }

    static func write(_ path: String, data: Data) throws {
        let (_, relative, url) = try resolve(path)
        guard !relative.isEmpty else { throw MeshNetError("EISDIR illegal operation on a directory, open '\(path)'") }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        // .atomic writes a temporary file and renames it over the target. The sidecar may read
        // these files while the device is locked, so keep them readable after first unlock.
        try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func remove(_ path: String) throws {
        let (_, relative, url) = try resolve(path)
        guard !relative.isEmpty else {
            // Clearing the whole shared dir keeps the (recreated) root.
            for child in (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? [] {
                try FileManager.default.removeItem(at: url.appendingPathComponent(child))
            }
            return
        }
        guard FileManager.default.fileExists(atPath: url.path) else { return }
        try FileManager.default.removeItem(at: url)
    }
}
