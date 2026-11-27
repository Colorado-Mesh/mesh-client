#if DEBUG
import Capacitor
import Foundation
import os
import WebKit

/// CI smoke probe (DEBUG builds only), enabled by launching the app with `--mesh-smoke`
/// (`mobile/ios/scripts/ci-simulator-smoke.sh`). It polls the page until the renderer replaces the boot
/// screen, checks OPFS from the page origin, and writes the verdict to
/// `<data container>/Documents/mesh-smoke.json` so pass/fail does not depend on log plumbing.
/// It also logs `[mesh-smoke] …` lines to stderr and the unified log.
///
/// The host worker relays `[mobile/host] main loaded (sqlite=…)` to the page console at info
/// level (`mobile/src/host/worker.ts`). The SQLite backend is taken from, in order: that line,
/// the forwarded "OPFS SQLite pool unavailable" warning (memory
/// fallback; matched by text because its mcL id differs between the desktop and mobile ranges),
/// or the presence of the OPFS SAH-pool directory (`mesh-sqlite`) the host creates on success.
final class MeshSmokeProbe {
    static let shared = MeshSmokeProbe()

    static var isEnabled: Bool { ProcessInfo.processInfo.arguments.contains("--mesh-smoke") }

    private let logger = Logger(subsystem: "org.coloradomesh.meshclient", category: "smoke")
    private let lock = NSLock()
    private var consoleLines: [String] = []
    private weak var webView: WKWebView?
    private var timer: Timer?
    private let started = Date()
    private var bootedAt: Date?
    private var lastState = ""
    private var finished = false

    private var timeout: TimeInterval {
        Double(ProcessInfo.processInfo.environment["MESH_SMOKE_TIMEOUT_S"] ?? "") ?? 240
    }

    private static let stateScript = """
    (function () {
      var root = document.getElementById('root');
      var err = document.querySelector('.mobile-boot__error');
      var de = document.documentElement;
      return JSON.stringify({
        href: String(location.href),
        readyState: document.readyState,
        rootChildren: root ? root.childElementCount : -1,
        bootScreen: !!document.querySelector('.mobile-boot'),
        bootError: err ? String(err.textContent || '').slice(0, 2000) : null,
        electronAPI: typeof window.electronAPI,
        secureContext: window.isSecureContext === true,
        platform: window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : null,
        viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
        mobile: {
          panes: de.dataset.mobilePanes || null,
          width: de.dataset.mobileWidth || null,
          posture: de.dataset.mobilePosture || null,
          fold: de.dataset.mobileFold || null,
          nav: de.dataset.mobileNav || null
        },
        sideColumn: de.dataset.mobileSideColumn ? {
          edge: de.dataset.mobileSideColumn,
          width: de.style.getPropertyValue('--mobile-side-column-width'),
          top: de.style.getPropertyValue('--mobile-side-column-top'),
          bottom: de.style.getPropertyValue('--mobile-side-column-bottom')
        } : null,
        title: document.title
      });
    })()
    """

    private static let opfsScript = """
    const out = { api: !!(navigator.storage && navigator.storage.getDirectory) };
    if (!out.api) return JSON.stringify(out);
    try {
      const root = await navigator.storage.getDirectory();
      try {
        const dir = await root.getDirectoryHandle('mesh-sqlite');
        out.poolDir = true;
        let entries = 0;
        try { for await (const _ of dir.keys()) entries++; } catch (e) { entries = -1; }
        out.poolEntries = entries;
      } catch (e) {
        out.poolDir = false;
        out.poolDirError = String((e && e.name) || e);
      }
    } catch (e) {
      out.error = String((e && e.message) || e);
    }
    return JSON.stringify(out);
    """

    // Threading: the probe itself is not actor-isolated; every WebKit/UIKit call is made inside a
    // `Task { @MainActor in … }`, and results come back through non-isolated methods. The polling
    // timer and all completions run on the main thread, so the probe's own state is only touched
    // there (the console buffer, fed from Capacitor's bridge queue, has its own lock).

    func attach(to webView: WKWebView?) {
        self.webView = webView
        emit("enabled (timeout \(Int(timeout)) s)")
        DispatchQueue.main.async { [self] in
            timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.tick() }
        }
    }

    /// Page console lines (from `MeshSmokeConsolePlugin`), any thread.
    func record(level: String, message: String) {
        let interesting = level == "error" || level == "warn" || message.contains("[mobile")
            || message.contains("OPFS SQLite pool unavailable")
        guard interesting else { return }
        lock.lock()
        consoleLines.append("[\(level)] \(message.prefix(1000))")
        if consoleLines.count > 300 { consoleLines.removeFirst(consoleLines.count - 300) }
        lock.unlock()
    }

    private func emit(_ line: String) {
        let text = "[mesh-smoke] \(line)"
        logger.notice("\(text, privacy: .public)")
        FileHandle.standardError.write(Data((text + "\n").utf8))
    }

    private func tick() {
        guard !finished else { return }
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard let webView = self.webView else {
                self.finish(status: "no-webview", state: [:], opfs: nil, folds: [])
                return
            }
            webView.evaluateJavaScript(Self.stateScript) { [weak self] result, error in
                self?.handleState(result, error)
            }
        }
    }

    private func handleState(_ result: Any?, _ error: Error?) {
        guard !finished else { return }
        var state: [String: Any] = [:]
        if let json = result as? String, let data = json.data(using: .utf8),
           let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            state = parsed
        } else if let error {
            state["evaluateError"] = error.localizedDescription
        }
        let summary = Self.summary(state)
        if summary != lastState {
            lastState = summary
            emit("state \(summary)")
        }
        let elapsed = Date().timeIntervalSince(started)
        let booted = (state["bootScreen"] as? Bool) == false
            && ((state["rootChildren"] as? Int) ?? 0) > 0
            && (state["electronAPI"] as? String) == "object"
        if let bootError = state["bootError"] as? String {
            emit("BOOT_FAILED \(bootError)")
            finishWithOpfs(status: "boot-failed", state: state)
        } else if booted {
            // Stay booted for one more poll so a crash or error right after mount still shows.
            if let bootedAt, Date().timeIntervalSince(bootedAt) >= 3.5 {
                finishWithOpfs(status: "booted", state: state)
            } else if bootedAt == nil {
                bootedAt = Date()
                emit("BOOTED after \(Int(elapsed)) s")
            }
        } else if elapsed > timeout {
            emit("TIMEOUT after \(Int(elapsed)) s")
            finishWithOpfs(status: "timeout", state: state)
        }
    }

    private static func summary(_ state: [String: Any]) -> String {
        let keys = ["readyState", "rootChildren", "bootScreen", "electronAPI", "bootError", "evaluateError"]
        return keys.map { "\($0)=\(state[$0].map { "\($0)" } ?? "-")" }.joined(separator: " ")
    }

    private func finishWithOpfs(status: String, state: [String: Any]) {
        timer?.invalidate()
        timer = nil
        Task { @MainActor [weak self] in
            guard let self else { return }
            // Display geometry as the page sees it (reserved regions, safe area, view size), so a
            // run on the iPhone Duo simulator records the real side column and camera rectangles.
            var geometry: [String: Any] = (self.webView as? MeshWebView)?.currentRegions().dictionary
                ?? ["folds": [], "occlusions": []]
            if let view = self.webView {
                let insets = view.safeAreaInsets
                geometry["safeArea"] = [
                    "top": Double(insets.top), "right": Double(insets.right),
                    "bottom": Double(insets.bottom), "left": Double(insets.left),
                ]
                geometry["viewSize"] = [
                    "width": Double(view.bounds.width), "height": Double(view.bounds.height),
                ]
            }
            guard let webView = self.webView else {
                self.finish(status: status, state: state, opfs: nil, geometry: geometry)
                return
            }
            webView.callAsyncJavaScript(Self.opfsScript, arguments: [:], in: nil, in: .page) { [weak self] result in
                var opfs: [String: Any] = [:]
                switch result {
                case .success(let value):
                    if let json = value as? String, let data = json.data(using: .utf8),
                       let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        opfs = parsed
                    }
                case .failure(let error):
                    opfs["error"] = error.localizedDescription
                }
                self?.finish(status: status, state: state, opfs: opfs, geometry: geometry)
            }
        }
    }

    private func finish(status: String, state: [String: Any], opfs: [String: Any]?, geometry: [String: Any]) {
        guard !finished else { return }
        finished = true
        timer?.invalidate()
        timer = nil
        lock.lock()
        let console = consoleLines
        lock.unlock()

        var sqlite = "unknown"
        var evidence = "none"
        let hostLine = console.first { $0.contains("main loaded (sqlite=") }
        if let hostLine, let range = hostLine.range(of: #"sqlite=([a-z-]+)"#, options: .regularExpression) {
            sqlite = String(hostLine[range].dropFirst("sqlite=".count))
            evidence = "host-log"
        } else if console.contains(where: { $0.contains("OPFS SQLite pool unavailable") }) {
            sqlite = "memory"
            evidence = "opfs-unavailable-warning"
        } else if (opfs?["poolDir"] as? Bool) == true {
            sqlite = "opfs-sahpool"
            evidence = "opfs-pool-dir"
        }

        let result: [String: Any] = [
            "status": status,
            "elapsedMs": Int(Date().timeIntervalSince(started) * 1000),
            "sqlite": sqlite,
            "sqliteEvidence": evidence,
            "secureKeyBackend": MeshSecureKey.backend,
            "sidecarAvailable": MeshProcessPlugin.sidecarAvailable,
            "model": MeshDevicePlugin.hardwareModel(),
            "geometry": geometry,
            "state": state,
            "opfs": opfs ?? [:],
            "console": console,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: result, options: [.sortedKeys]) else {
            emit("RESULT could not encode the result")
            return
        }
        do {
            let documents = try FileManager.default.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            try data.write(to: documents.appendingPathComponent("mesh-smoke.json"), options: .atomic)
        } catch {
            emit("could not write mesh-smoke.json: \(error.localizedDescription)")
        }
        emit("RESULT \(String(decoding: data, as: UTF8.self))")
    }
}

/// Replaces Capacitor's `Console` plugin while the smoke probe runs: same output
/// (`⚡️  [level] - message` on stdout) plus a copy for the probe. Capacitor's iOS bridge routes
/// every page `console.*` call here (`native-bridge.js`).
@objc(MeshSmokeConsolePlugin)
public class MeshSmokeConsolePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeshSmokeConsolePlugin"
    public let jsName = "Console"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "log", returnType: CAPPluginReturnNone),
    ]

    @objc func log(_ call: CAPPluginCall) {
        let message = call.getString("message") ?? ""
        let level = call.getString("level") ?? "log"
        CAPLog.print("⚡️  [\(level)] - \(message)")
        MeshSmokeProbe.shared.record(level: level, message: message)
    }
}
#endif
