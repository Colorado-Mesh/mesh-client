import Capacitor
import Foundation
import Network

/// `MeshNet` Capacitor plugin: TCP/TLS sockets and servers (Network.framework), UDP (BSD sockets),
/// DNS (`getaddrinfo`), streaming HTTP and WebSocket client (URLSession). Contract:
/// `mobile/src/native/contracts.ts`; reference implementation: `mobile/scripts/web-bridge.mjs`.
///
/// Threading: Capacitor calls every plugin method on its single serial `bridge` queue, so methods
/// only validate and hop to `queue` (never block there). All socket state lives on `queue`, and
/// results and events go back through the bridge queue in one FIFO stream, which keeps per-socket
/// ordering (`tcpConnect` result → `tcpData`… → `tcpEnd` → `tcpClose`) and avoids racing
/// Capacitor's listener table (`addListener` also runs on the bridge queue).
@objc(MeshNetPlugin)
public class MeshNetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MeshNetPlugin"
    public let jsName = "MeshNet"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "tcpConnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpWrite", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpEnd", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpDestroy", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpSetOptions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpListen", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "tcpServerClose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpCreate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpBind", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpSend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpClose", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpSetOptions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpAddMembership", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "udpDropMembership", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "dnsLookup", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "httpRequest", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "httpCancel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wsConnect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wsSend", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "wsClose", returnType: CAPPluginReturnPromise),
    ]

    let queue = DispatchQueue(label: "org.coloradomesh.meshclient.meshnet", qos: .userInitiated)
    var tcpSockets: [String: MeshTcpSocket] = [:]
    private var tcpServers: [String: MeshTcpServer] = [:]
    private var udpSockets: [String: MeshUdpSocket] = [:]
    private var webStack: MeshWebStack?
    private var deliveryQueue: DispatchQueue?

    override public func load() {
        deliveryQueue = (bridge as? CapacitorBridge)?.dispatchQueue
        queue.async { [self] in
            webStack = MeshWebStack(plugin: self, queue: queue)
        }
    }

    // MARK: Delivery (call from `queue`)

    private func deliver(_ block: @escaping () -> Void) {
        (deliveryQueue ?? DispatchQueue.main).async(execute: block)
    }

    func emit(_ event: String, _ data: [String: Any]) {
        deliver { [weak self] in self?.notifyListeners(event, data: data) }
    }

    func resolve(_ call: CAPPluginCall, _ data: [String: Any] = [:]) {
        deliver { call.resolve(data) }
    }

    func reject(_ call: CAPPluginCall, _ message: String) {
        deliver { call.reject(message) }
    }

    /// Runs `body` on the socket queue; a thrown error rejects the call.
    private func run(_ call: CAPPluginCall, _ body: @escaping () throws -> Void) {
        queue.async { [self] in
            do {
                try body()
            } catch {
                reject(call, MeshNetError.text(error))
            }
        }
    }

    func tcpSocketDidClose(_ id: String) {
        tcpSockets[id] = nil
    }

    // MARK: TCP / TLS client

    @objc func tcpConnect(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            let host = try call.meshString("host")
            let port = try call.meshPort("port")
            guard port != 0 else { throw MeshNetError("ERR_SOCKET_BAD_PORT port should be > 0") }
            let tls = call.meshBool("tls") ?? false
            let timeoutMs = call.meshInt("timeoutMs") ?? 20_000

            let tcp = NWProtocolTCP.Options()
            tcp.noDelay = call.meshBool("noDelay") ?? true
            if call.meshBool("keepAlive") == true {
                tcp.enableKeepalive = true
                let delaySeconds = (call.meshInt("keepAliveDelayMs") ?? 0) / 1000
                if delaySeconds > 0 { tcp.keepaliveIdle = delaySeconds }
            }
            tcp.connectionTimeout = max(1, Int((Double(timeoutMs) / 1000).rounded(.up)))

            var tlsOptions: NWProtocolTLS.Options?
            let verification = MeshTlsVerification()
            if tls {
                let anchors = try MeshTlsCredentials.certificates(fromBase64: call.meshBase64List("caB64"))
                let identity = try MeshTlsCredentials.identity(
                    pfxB64: call.getString("pfxB64").flatMap { $0.isEmpty ? nil : $0 },
                    passphrase: call.getString("passphrase"),
                    certB64: call.getString("certB64").flatMap { $0.isEmpty ? nil : $0 },
                    keyB64: call.getString("keyB64").flatMap { $0.isEmpty ? nil : $0 }
                )
                tlsOptions = MeshTls.clientOptions(
                    host: host,
                    servername: call.getString("servername"),
                    rejectUnauthorized: call.meshBool("rejectUnauthorized") ?? true,
                    anchors: anchors,
                    identity: identity,
                    alpn: (call.getArray("alpn") ?? []).compactMap { $0 as? String },
                    queue: queue,
                    record: verification
                )
            }
            let parameters = NWParameters(tls: tlsOptions, tcp: tcp)
            guard let nwPort = NWEndpoint.Port(rawValue: port) else {
                throw MeshNetError("ERR_SOCKET_BAD_PORT invalid port \(port)")
            }
            let connection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: parameters)
            tcpSockets[id]?.destroy()
            let socket = MeshTcpSocket(
                id: id,
                connection: connection,
                plugin: self,
                host: host,
                port: Int(port),
                tls: tls,
                verification: verification
            )
            tcpSockets[id] = socket
            socket.start(queue: queue, timeoutMs: timeoutMs) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let info):
                    self.resolve(call, info)
                case .failure(let error):
                    if self.tcpSockets[id] === socket { self.tcpSockets[id] = nil }
                    self.reject(call, error.message)
                }
            }
        }
    }

    @objc func tcpWrite(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            let data = try call.meshData("dataB64")
            guard let socket = tcpSockets[id] else { throw MeshNetError("EPIPE write EPIPE (socket is closed)") }
            socket.write(data) { [weak self] error in
                if let error { self?.reject(call, error.message) } else { self?.resolve(call) }
            }
        }
    }

    @objc func tcpEnd(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            tcpSockets[id]?.end()
            resolve(call)
        }
    }

    @objc func tcpDestroy(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            tcpSockets[id]?.destroy()
            resolve(call)
        }
    }

    /// Network.framework fixes TCP options when the connection starts; `noDelay` / `keepAlive`
    /// passed to `tcpConnect` apply, later changes are accepted and ignored.
    @objc func tcpSetOptions(_ call: CAPPluginCall) {
        resolveNow(call)
    }

    private func resolveNow(_ call: CAPPluginCall) {
        queue.async { [self] in resolve(call) }
    }

    // MARK: TCP / TLS server

    @objc func tcpListen(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            let host = call.getString("host") ?? "127.0.0.1"
            let port = try call.meshPort("port")
            var tlsOptions: NWProtocolTLS.Options?
            if let tls = call.getObject("tls") {
                let identity = try MeshTlsCredentials.identity(
                    pfxB64: tls.meshString("pfxB64"),
                    passphrase: tls.meshString("passphrase"),
                    certB64: tls.meshString("certB64"),
                    keyB64: tls.meshString("keyB64")
                )
                guard let identity else {
                    throw MeshNetError("ERR_SSL_NO_CERTIFICATE a TLS server needs cert + key or pfx")
                }
                tlsOptions = try MeshTls.serverOptions(
                    identity: identity,
                    requestCert: tls.meshBool("requestCert") ?? false,
                    rejectUnauthorized: tls.meshBool("rejectUnauthorized") ?? true,
                    anchors: MeshTlsCredentials.certificates(fromBase64: tls.meshBase64List("caB64")),
                    queue: queue
                )
            }
            tcpServers[id]?.close()
            let server = try MeshTcpServer(id: id, host: host, port: port, tlsOptions: tlsOptions, plugin: self)
            tcpServers[id] = server
            server.start(queue: queue) { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let info):
                    self.resolve(call, info)
                case .failure(let error):
                    if self.tcpServers[id] === server { self.tcpServers[id] = nil }
                    self.reject(call, error.message)
                }
            }
        }
    }

    @objc func tcpServerClose(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            tcpServers.removeValue(forKey: id)?.close()
            resolve(call)
        }
    }

    // MARK: UDP

    @objc func udpCreate(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            let socket = try MeshUdpSocket(
                id: id,
                ipv6: call.getString("type") == "udp6",
                reuseAddr: call.meshBool("reuseAddr") ?? false,
                plugin: self
            )
            udpSockets[id]?.close()
            udpSockets[id] = socket
            socket.start(queue: queue)
            resolve(call)
        }
    }

    private func udpSocket(_ call: CAPPluginCall) throws -> MeshUdpSocket {
        let id = try call.meshString("id")
        guard let socket = udpSockets[id] else {
            throw MeshNetError("ERR_SOCKET_DGRAM_NOT_RUNNING Not running")
        }
        return socket
    }

    @objc func udpBind(_ call: CAPPluginCall) {
        run(call) { [self] in
            let socket = try udpSocket(call)
            let address = call.getString("address").flatMap { $0.isEmpty ? nil : $0 }
            let port = try call.meshPort("port")
            if let address, !MeshSockaddr.isNumeric(address) {
                // Node resolves a host name before binding; never block the socket queue on DNS.
                DispatchQueue.global(qos: .userInitiated).async { [self] in
                    let lookup = MeshDNS.lookup(address, family: 0)
                    queue.async { [self] in
                        switch lookup {
                        case .success(let list):
                            do {
                                let first = list.first?["address"] as? String ?? address
                                let bound = try socket.bind(address: first, port: port)
                                resolve(call, bound)
                            } catch {
                                reject(call, MeshNetError.text(error))
                            }
                        case .failure(let error):
                            reject(call, error.message)
                        }
                    }
                }
                return
            }
            let bound = try socket.bind(address: address ?? (socket.isIPv6 ? "::" : "0.0.0.0"), port: port)
            resolve(call, bound)
        }
    }

    @objc func udpSend(_ call: CAPPluginCall) {
        run(call) { [self] in
            let socket = try udpSocket(call)
            let data = try call.meshData("dataB64")
            let port = try call.meshPort("port")
            let address = try call.meshString("address")
            if MeshSockaddr.isNumeric(address) {
                try socket.send(data, address: address, port: port)
                resolve(call)
                return
            }
            DispatchQueue.global(qos: .userInitiated).async { [self] in
                let lookup = MeshDNS.lookup(address, family: 0)
                queue.async { [self] in
                    switch lookup {
                    case .success(let list):
                        do {
                            try socket.send(data, address: list.first?["address"] as? String ?? address, port: port)
                            resolve(call)
                        } catch {
                            reject(call, MeshNetError.text(error))
                        }
                    case .failure(let error):
                        reject(call, error.message)
                    }
                }
            }
        }
    }

    @objc func udpClose(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            udpSockets.removeValue(forKey: id)?.close()
            resolve(call)
        }
    }

    @objc func udpSetOptions(_ call: CAPPluginCall) {
        run(call) { [self] in
            let socket = try udpSocket(call)
            if let broadcast = call.meshBool("broadcast") { try socket.setBroadcast(broadcast) }
            if let ttl = call.meshInt("multicastTtl") { try socket.setMulticastTTL(ttl) }
            if let loopback = call.meshBool("multicastLoopback") { try socket.setMulticastLoopback(loopback) }
            resolve(call)
        }
    }

    @objc func udpAddMembership(_ call: CAPPluginCall) {
        run(call) { [self] in
            let socket = try udpSocket(call)
            let group = try call.meshString("group")
            try socket.membership(group: group, iface: call.getString("iface"), join: true)
            resolve(call)
        }
    }

    @objc func udpDropMembership(_ call: CAPPluginCall) {
        run(call) { [self] in
            let socket = try udpSocket(call)
            let group = try call.meshString("group")
            try socket.membership(group: group, iface: call.getString("iface"), join: false)
            resolve(call)
        }
    }

    // MARK: DNS

    @objc func dnsLookup(_ call: CAPPluginCall) {
        guard let hostname = call.getString("hostname"), !hostname.isEmpty else {
            call.reject("ERR_INVALID_ARG_TYPE missing hostname")
            return
        }
        let family = call.meshInt("family") ?? 0
        // getaddrinfo blocks: run it off both the bridge queue and the socket queue.
        DispatchQueue.global(qos: .userInitiated).async { [self] in
            switch MeshDNS.lookup(hostname, family: family) {
            case .success(let addresses):
                resolve(call, ["addresses": addresses])
            case .failure(let error):
                reject(call, error.message)
            }
        }
    }

    // MARK: HTTP

    @objc func httpRequest(_ call: CAPPluginCall) {
        run(call) { [self] in
            guard let webStack else { throw MeshNetError("ERR_INVALID_STATE MeshNet is not ready") }
            try webStack.request(call)
        }
    }

    @objc func httpCancel(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            webStack?.cancelRequest(id: id)
            resolve(call)
        }
    }

    // MARK: WebSocket

    @objc func wsConnect(_ call: CAPPluginCall) {
        run(call) { [self] in
            guard let webStack else { throw MeshNetError("ERR_INVALID_STATE MeshNet is not ready") }
            try webStack.webSocketConnect(call)
            resolve(call)
        }
    }

    @objc func wsSend(_ call: CAPPluginCall) {
        run(call) { [self] in
            guard let webStack else { throw MeshNetError("WebSocket is not open") }
            try webStack.webSocketSend(call)
        }
    }

    @objc func wsClose(_ call: CAPPluginCall) {
        run(call) { [self] in
            let id = try call.meshString("id")
            webStack?.webSocketClose(
                id: id,
                code: call.meshInt("code") ?? 1000,
                reason: call.getString("reason") ?? ""
            )
            resolve(call)
        }
    }
}
