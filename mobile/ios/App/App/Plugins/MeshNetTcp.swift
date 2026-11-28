import Foundation
import Network

/// One `MeshNet` TCP/TLS socket (client or accepted) over `NWConnection`. Every method and
/// callback runs on the plugin's serial queue, so state needs no locking and events leave in
/// order: all `tcpData` for a socket precede its `tcpEnd`/`tcpClose`.
final class MeshTcpSocket {
    let id: String
    let connection: NWConnection
    let verification: MeshTlsVerification
    private weak var plugin: MeshNetPlugin?
    private let host: String?
    private let port: Int?
    private let tls: Bool
    private var connected = false
    private var closed = false
    private var readClosed = false
    private var writeClosed = false
    private var connectTimer: DispatchWorkItem?
    private var onConnect: ((Result<[String: Any], MeshNetError>) -> Void)?

    init(
        id: String,
        connection: NWConnection,
        plugin: MeshNetPlugin,
        host: String?,
        port: Int?,
        tls: Bool,
        verification: MeshTlsVerification = MeshTlsVerification()
    ) {
        self.id = id
        self.connection = connection
        self.plugin = plugin
        self.host = host
        self.port = port
        self.tls = tls
        self.verification = verification
    }

    var isConnected: Bool { connected && !closed }

    /// Starts the connection. `onConnect` fires once: with the `TcpConnectResult` fields after the
    /// TCP (and TLS) handshake, or with a Node-style error. Data is read only after it fires, so a
    /// socket's `tcpData` never precedes its `tcpConnect` result / `tcpAccept` event.
    func start(queue: DispatchQueue, timeoutMs: Int?, onConnect: @escaping (Result<[String: Any], MeshNetError>) -> Void) {
        self.onConnect = onConnect
        connection.stateUpdateHandler = { [weak self] state in self?.handle(state) }
        if let timeoutMs, timeoutMs > 0 {
            let target = targetDescription
            let timer = DispatchWorkItem { [weak self] in
                self?.failConnect(MeshNetError("ETIMEDOUT connect ETIMEDOUT \(target)"))
            }
            connectTimer = timer
            queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: timer)
        }
        connection.start(queue: queue)
    }

    private var targetDescription: String {
        if let host, let port { return "\(host):\(port)" }
        return MeshAddress.split(connection.endpoint).map { "\($0.address):\($0.port)" } ?? "\(connection.endpoint)"
    }

    private func handle(_ state: NWConnection.State) {
        switch state {
        case .ready:
            guard !connected, !closed else { return }
            connected = true
            connectTimer?.cancel()
            connectTimer = nil
            var info = MeshAddress.connectionInfo(connection)
            if tls {
                info["authorized"] = verification.authorized
                if let error = verification.error { info["authorizationError"] = error }
                if let alpn = negotiatedProtocol() { info["alpnProtocol"] = alpn }
            }
            let callback = onConnect
            onConnect = nil
            callback?(.success(info))
            receive()
        case .waiting(let error), .failed(let error):
            // A refused or unroutable connect parks in `.waiting` (Network.framework would retry on
            // path changes); Node fails immediately, so both states end the attempt.
            if connected {
                finish(error: MeshNWError.message(error, syscall: "read", host: nil, port: nil))
            } else {
                failConnect(MeshNetError(connectFailure(error)))
            }
        case .cancelled:
            if connected {
                finish(error: nil)
            } else {
                failConnect(MeshNetError("ECONNABORTED connect ECONNABORTED \(targetDescription)"))
            }
        default:
            break
        }
    }

    private func connectFailure(_ error: NWError) -> String {
        if case .tls = error, let reason = verification.error { return reason }
        let endpoint = MeshAddress.split(connection.endpoint)
        return MeshNWError.message(error, syscall: "connect", host: host ?? endpoint?.address, port: port ?? endpoint?.port)
    }

    private func negotiatedProtocol() -> String? {
        guard let metadata = connection.metadata(definition: NWProtocolTLS.definition) as? NWProtocolTLS.Metadata,
              let proto = sec_protocol_metadata_get_negotiated_protocol(metadata.securityProtocolMetadata) else {
            return nil
        }
        return String(cString: proto)
    }

    private func failConnect(_ error: MeshNetError) {
        guard !connected, !closed else { return }
        closed = true
        connectTimer?.cancel()
        connectTimer = nil
        connection.stateUpdateHandler = nil
        connection.cancel()
        let callback = onConnect
        onConnect = nil
        callback?(.failure(error))
    }

    private func receive() {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, isComplete, error in
            guard let self, !self.closed else { return }
            if let data, !data.isEmpty {
                self.plugin?.emit("tcpData", ["id": self.id, "dataB64": data.base64EncodedString()])
            }
            if let error {
                self.finish(error: MeshNWError.message(error, syscall: "read", host: nil, port: nil))
                return
            }
            if isComplete {
                // Peer sent FIN. The JS socket (allowHalfOpen: false) answers with tcpEnd.
                self.readClosed = true
                self.plugin?.emit("tcpEnd", ["id": self.id])
                if self.writeClosed { self.finish(error: nil) }
                return
            }
            self.receive()
        }
    }

    /// Queues `data`; Network.framework keeps send order, and `completion` fires once the bytes are
    /// handed to the stack (Node's write callback).
    func write(_ data: Data, completion: @escaping (MeshNetError?) -> Void) {
        guard connected, !closed, !writeClosed else {
            completion(MeshNetError("EPIPE write EPIPE (socket is closed)"))
            return
        }
        connection.send(content: data, completion: .contentProcessed { error in
            completion(error.map { MeshNetError(MeshNWError.message($0, syscall: "write", host: nil, port: nil)) })
        })
    }

    /// Half-close (FIN) after the queued writes.
    func end() {
        guard connected, !closed, !writeClosed else { return }
        writeClosed = true
        connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self] _ in
            guard let self, !self.closed else { return }
            if self.readClosed { self.finish(error: nil) }
        })
    }

    /// `tcpDestroy`: aborts a pending connect (rejecting `tcpConnect`) or closes the socket.
    func destroy() {
        if connected {
            finish(error: nil)
        } else {
            failConnect(MeshNetError("ECONNABORTED connect ECONNABORTED \(targetDescription) (destroyed)"))
        }
    }

    /// Closes the connection and emits `tcpClose` exactly once.
    func finish(error: String?) {
        guard !closed else { return }
        closed = true
        connectTimer?.cancel()
        connection.stateUpdateHandler = nil
        connection.cancel()
        plugin?.tcpSocketDidClose(id)
        var payload: [String: Any] = ["id": id]
        if let error { payload["error"] = error }
        plugin?.emit("tcpClose", payload)
    }
}

/// `tcpListen` server over `NWListener`; accepted connections become `MeshTcpSocket`s with ids
/// `<serverId>:<n>` announced by `tcpAccept` (after the TLS handshake for TLS servers).
final class MeshTcpServer {
    let id: String
    private let listener: NWListener
    private let host: String
    private let tls: Bool
    private weak var plugin: MeshNetPlugin?
    private var accepted = 0
    private var ready = false
    private var closed = false
    private var onListen: ((Result<[String: Any], MeshNetError>) -> Void)?

    init(id: String, host: String, port: UInt16, tlsOptions: NWProtocolTLS.Options?, plugin: MeshNetPlugin) throws {
        self.id = id
        self.host = host
        self.tls = tlsOptions != nil
        self.plugin = plugin
        let tcp = NWProtocolTCP.Options()
        tcp.noDelay = true
        let parameters = NWParameters(tls: tlsOptions, tcp: tcp)
        parameters.allowLocalEndpointReuse = true
        let nwPort = port == 0 ? NWEndpoint.Port.any : (NWEndpoint.Port(rawValue: port) ?? .any)
        let wildcard = host.isEmpty || host == "0.0.0.0" || host == "::"
        do {
            if wildcard {
                listener = try NWListener(using: parameters, on: nwPort)
            } else {
                // Bind a specific local address (e.g. 127.0.0.1 for loopback-only servers).
                parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host(host), port: nwPort)
                listener = try NWListener(using: parameters)
            }
        } catch {
            let detail = (error as? NWError).map { MeshNWError.message($0, syscall: "listen", host: host, port: Int(port)) }
            throw MeshNetError(detail ?? "EADDRNOTAVAIL listen EADDRNOTAVAIL \(host):\(port)")
        }
    }

    func start(queue: DispatchQueue, onListen: @escaping (Result<[String: Any], MeshNetError>) -> Void) {
        self.onListen = onListen
        listener.stateUpdateHandler = { [weak self] state in self?.handle(state) }
        listener.newConnectionHandler = { [weak self] connection in self?.accept(connection, queue: queue) }
        listener.start(queue: queue)
    }

    private func handle(_ state: NWListener.State) {
        switch state {
        case .ready:
            guard !ready, !closed else { return }
            ready = true
            let callback = onListen
            onListen = nil
            callback?(.success(["port": Int(listener.port?.rawValue ?? 0), "host": host.isEmpty ? "0.0.0.0" : host]))
        case .waiting(let error), .failed(let error):
            if ready {
                NSLog("[MeshNet] listener %@ stopped: %@", id, "\(error)")
                return
            }
            fail(MeshNetError(MeshNWError.message(error, syscall: "listen", host: host, port: nil)))
        case .cancelled:
            if !ready { fail(MeshNetError("ECONNABORTED listen ECONNABORTED \(host)")) }
        default:
            break
        }
    }

    private func fail(_ error: MeshNetError) {
        guard !closed else { return }
        closed = true
        listener.stateUpdateHandler = nil
        listener.newConnectionHandler = nil
        listener.cancel()
        let callback = onListen
        onListen = nil
        callback?(.failure(error))
    }

    private func accept(_ connection: NWConnection, queue: DispatchQueue) {
        guard let plugin, !closed else {
            connection.cancel()
            return
        }
        accepted += 1
        let socketId = "\(id):\(accepted)"
        let socket = MeshTcpSocket(id: socketId, connection: connection, plugin: plugin, host: nil, port: nil, tls: tls)
        plugin.tcpSockets[socketId] = socket
        let serverId = id
        // The accepted socket must finish its (TLS) handshake within 30 s, like Node's default
        // `handshakeTimeout` for TLS servers.
        socket.start(queue: queue, timeoutMs: 30_000) { [weak plugin] result in
            switch result {
            case .success(var info):
                info["serverId"] = serverId
                info["id"] = socketId
                plugin?.emit("tcpAccept", info)
            case .failure:
                plugin?.tcpSockets[socketId] = nil
            }
        }
    }

    /// Stops accepting; established connections stay open (Node `server.close()`).
    func close() {
        guard !closed else { return }
        closed = true
        listener.stateUpdateHandler = nil
        listener.newConnectionHandler = nil
        listener.cancel()
        let callback = onListen
        onListen = nil
        callback?(.failure(MeshNetError("ECONNABORTED listen ECONNABORTED \(host) (closed)")))
    }
}
