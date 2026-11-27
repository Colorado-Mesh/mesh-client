import Capacitor
import Darwin
import Foundation
import Security
import UIKit

/// `MeshDevice` Capacitor plugin: safeStorage key, app info, fold state, keep-awake.
@objc(MeshDevicePlugin)
public class MeshDevicePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeshDevicePlugin"
    public let jsName = "MeshDevice"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getSecureKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getFoldState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "keepAwake", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBackgroundMode", returnType: CAPPluginReturnPromise),
    ]

    private let keyQueue = DispatchQueue(label: "org.coloradomesh.meshclient.meshdevice.key")
    private var deliveryQueue: DispatchQueue?

    override public func load() {
        deliveryQueue = (bridge as? CapacitorBridge)?.dispatchQueue
    }

    @objc func getSecureKey(_ call: CAPPluginCall) {
        keyQueue.async {
            do {
                let keyHex = try MeshSecureKey.loadOrCreate()
                call.resolve(["keyHex": keyHex])
            } catch {
                call.reject(MeshNetError.text(error))
            }
        }
    }

    @objc func getInfo(_ call: CAPPluginCall) {
        let version = ProcessInfo.processInfo.operatingSystemVersion
        var osVersion = "\(version.majorVersion).\(version.minorVersion)"
        if version.patchVersion > 0 { osVersion += ".\(version.patchVersion)" }
        call.resolve([
            "appVersion": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0",
            "sidecarAvailable": MeshProcessPlugin.sidecarAvailable,
            // BCP 47 ("en-US"), the format navigator.language / Electron app.getLocale() use.
            "locale": Locale.preferredLanguages.first ?? Locale.current.identifier.replacingOccurrences(of: "_", with: "-"),
            "model": Self.hardwareModel(),
            "osVersion": osVersion,
        ])
    }

    @objc func getFoldState(_ call: CAPPluginCall) {
        let webView = self.webView
        Task { @MainActor in
            let folds = (webView as? MeshWebView)?.currentFolds() ?? []
            call.resolve(["folds": folds.map(\.dictionary)])
        }
    }

    @objc func keepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        Task { @MainActor in
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve()
        }
    }

    /// iOS has no foreground-service equivalent: BLE radios keep working through the
    /// `bluetooth-central` background mode (Info.plist) and sockets follow the system background
    /// policy, so this is a documented no-op.
    @objc func setBackgroundMode(_ call: CAPPluginCall) {
        call.resolve()
    }

    /// Main thread, from `MeshWebView`.
    func foldsDidChange(_ folds: [MeshFoldFeature]) {
        let payload: [String: Any] = ["folds": folds.map(\.dictionary)]
        (deliveryQueue ?? DispatchQueue.main).async { [weak self] in
            self?.notifyListeners("foldChanged", data: payload)
        }
    }

    static func hardwareModel() -> String {
        #if targetEnvironment(simulator)
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"] { return simulated }
        #endif
        var system = utsname()
        uname(&system)
        return withUnsafeBytes(of: &system.machine) { raw in
            String(decoding: raw.prefix { $0 != 0 }, as: UTF8.self)
        }
    }
}

/// The 32-byte key behind Electron `safeStorage` on mobile, generated once and kept in the
/// Keychain (this device only, readable after first unlock so background radio work can decrypt).
enum MeshSecureKey {
    private static let service = "org.coloradomesh.meshclient.safe-storage"
    private static let account = "safe-storage-key-v1"
    private static let lock = NSLock()
    private static var storedBackend = "keychain"

    /// Where the key lives: "keychain", or on the Simulator only "simulator-file (…)" (CI smoke).
    static var backend: String {
        lock.lock()
        defer { lock.unlock() }
        return storedBackend
    }

    private struct KeychainFailure: Error {
        let status: OSStatus
        let operation: String
    }

    static func loadOrCreate() throws -> String {
        do {
            let key = try keychainLoadOrCreate()
            return hex(key)
        } catch let failure as KeychainFailure {
            #if targetEnvironment(simulator)
            // Unsigned Simulator builds (CI uses CODE_SIGNING_ALLOWED=NO) have no keychain access
            // group and can fail with errSecMissingEntitlement (-34018). Simulator builds only:
            // keep the key in a protected file so the app still boots. Device builds never do this.
            NSLog("[MeshDevice] %@", "Keychain \(failure.operation) failed (OSStatus \(failure.status)); Simulator fallback key file in use")
            lock.lock()
            storedBackend = "simulator-file (keychain \(failure.operation) OSStatus \(failure.status))"
            lock.unlock()
            let key = try fileLoadOrCreate()
            return hex(key)
            #else
            throw MeshNetError(
                "EACCES safeStorage key unavailable: Keychain \(failure.operation) failed (OSStatus \(failure.status))"
            )
            #endif
        }
    }

    private static func hex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    private static func randomKey() throws -> Data {
        var bytes = [UInt8](repeating: 0, count: 32)
        let count = bytes.count
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        guard status == errSecSuccess else {
            throw MeshNetError("EIO could not generate the safeStorage key (OSStatus \(status))")
        }
        return Data(bytes)
    }

    private static var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func keychainLoadOrCreate(retry: Bool = true) throws -> Data {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data {
            // Never replace an existing key: everything encrypted with it would become unreadable.
            guard data.count == 32 else { throw KeychainFailure(status: errSecDecode, operation: "read (bad length)") }
            return data
        }
        guard status == errSecItemNotFound else { throw KeychainFailure(status: status, operation: "read") }
        let key = try randomKey()
        var add = baseQuery
        add[kSecValueData as String] = key
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let addStatus = SecItemAdd(add as CFDictionary, nil)
        if addStatus == errSecDuplicateItem, retry { return try keychainLoadOrCreate(retry: false) }
        guard addStatus == errSecSuccess else { throw KeychainFailure(status: addStatus, operation: "add") }
        return key
    }

    #if targetEnvironment(simulator)
    private static func fileLoadOrCreate() throws -> Data {
        let support = try FileManager.default.url(
            for: .applicationSupportDirectory,
            in: .userDomainMask,
            appropriateFor: nil,
            create: true
        )
        let url = support.appendingPathComponent("simulator-safe-storage.key")
        if let data = try? Data(contentsOf: url), data.count == 32 { return data }
        let key = try randomKey()
        try key.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        return key
    }
    #endif
}
