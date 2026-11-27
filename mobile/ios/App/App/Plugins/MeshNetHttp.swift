import Capacitor
import Foundation

/// Streaming HTTP (`httpRequest`) and WebSocket client (`wsConnect`) over one `URLSession` whose
/// delegate callbacks run on the MeshNet serial queue.
///
/// `x-mesh-pinned-address`: URLSession cannot connect to a chosen IP while keeping the URL host
/// for TLS/SNI, so the header is only stripped and the request resolves the host itself (the
/// contract allows this: "implementations that cannot pin connect normally").
final class MeshWebStack: NSObject, URLSessionDataDelegate, URLSessionWebSocketDelegate {
    private final class HttpRequest {
        let id: String
        let call: CAPPluginCall
        let followRedirects: Bool
        let task: URLSessionDataTask
        var started = false
        var cancelled = false

        init(id: String, call: CAPPluginCall, followRedirects: Bool, task: URLSessionDataTask) {
            self.id = id
            self.call = call
            self.followRedirects = followRedirects
            self.task = task
        }
    }

    private final class WebSocket {
        let id: String
        let task: URLSessionWebSocketTask
        let rejectUnauthorized: Bool
        var opened = false
        var closed = false
        var requestedClose: (code: Int, reason: String)?
        var timer: DispatchWorkItem?

        init(id: String, task: URLSessionWebSocketTask, rejectUnauthorized: Bool) {
            self.id = id
            self.task = task
            self.rejectUnauthorized = rejectUnauthorized
        }
    }

    private weak var plugin: MeshNetPlugin?
    private let queue: DispatchQueue
    private var session: URLSession?
    private var requests: [Int: HttpRequest] = [:]
    private var requestsById: [String: HttpRequest] = [:]
    private var sockets: [Int: WebSocket] = [:]
    private var socketsById: [String: WebSocket] = [:]

    /// Node `ws` default `maxPayload` (100 MiB).
    private static let maxWebSocketMessage = 100 * 1024 * 1024

    init(plugin: MeshNetPlugin, queue: DispatchQueue) {
        self.plugin = plugin
        self.queue = queue
        super.init()
        let configuration = URLSessionConfiguration.default
        // Behave like Node's fetch / ws: no HTTP cache, no cookie jar.
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.httpCookieAcceptPolicy = .never
        // undici's default headers/body timeout is 300 s; URLSession's idle default is 60 s.
        configuration.timeoutIntervalForRequest = 300
        configuration.waitsForConnectivity = false
        // undici does not cap connections per origin; long-lived streams to the sidecar on
        // 127.0.0.1 must not starve other requests behind URLSession's default of 6.
        configuration.httpMaximumConnectionsPerHost = 32
        let delegateQueue = OperationQueue()
        delegateQueue.name = "org.coloradomesh.meshclient.meshnet.urlsession"
        delegateQueue.maxConcurrentOperationCount = 1
        delegateQueue.underlyingQueue = queue
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: delegateQueue)
    }

    // MARK: HTTP

    func request(_ call: CAPPluginCall) throws {
        guard let session else { throw MeshNetError("ERR_INVALID_STATE HTTP session unavailable") }
        let id = try call.meshString("id")
        let urlText = try call.meshString("url")
        guard let url = URL(string: urlText), let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            throw MeshNetError("ERR_INVALID_URL Invalid URL: \(urlText)")
        }
        var request = URLRequest(url: url)
        request.httpMethod = (call.getString("method") ?? "GET").uppercased()
        request.timeoutInterval = 300
        for (name, value) in call.meshHeaders("headers") where name.lowercased() != "x-mesh-pinned-address" {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let body = call.getString("bodyB64"), !body.isEmpty {
            request.httpBody = try MeshTlsCredentials.decode(body, what: "bodyB64")
        }
        let task = session.dataTask(with: request)
        let entry = HttpRequest(id: id, call: call, followRedirects: call.meshBool("followRedirects") ?? true, task: task)
        requests[task.taskIdentifier] = entry
        requestsById[id] = entry
        task.resume()
    }

    func cancelRequest(id: String) {
        guard let entry = requestsById.removeValue(forKey: id) else { return }
        requests[entry.task.taskIdentifier] = nil
        entry.cancelled = true
        entry.task.cancel()
        if !entry.started { plugin?.reject(entry.call, "ECONNABORTED request aborted") }
    }

    private static func statusText(_ status: Int) -> String {
        switch status {
        case 200: return "OK"
        case 201: return "Created"
        case 202: return "Accepted"
        case 204: return "No Content"
        case 206: return "Partial Content"
        case 301: return "Moved Permanently"
        case 302: return "Found"
        case 303: return "See Other"
        case 304: return "Not Modified"
        case 307: return "Temporary Redirect"
        case 308: return "Permanent Redirect"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 408: return "Request Timeout"
        case 409: return "Conflict"
        case 410: return "Gone"
        case 413: return "Payload Too Large"
        case 415: return "Unsupported Media Type"
        case 429: return "Too Many Requests"
        case 500: return "Internal Server Error"
        case 501: return "Not Implemented"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        case 504: return "Gateway Timeout"
        default: return HTTPURLResponse.localizedString(forStatusCode: status).capitalized
        }
    }

    /// Node-style message for a URLSession failure.
    private static func message(for error: Error, url: URL?) -> String {
        let host = url?.host ?? ""
        guard let urlError = error as? URLError else { return "ECONNRESET \(error.localizedDescription)" }
        let detail = urlError.localizedDescription
        switch urlError.code {
        case .cannotFindHost, .dnsLookupFailed:
            return "ENOTFOUND getaddrinfo ENOTFOUND \(host) (\(detail))"
        case .cannotConnectToHost:
            return "ECONNREFUSED connect ECONNREFUSED \(host) (\(detail))"
        case .timedOut:
            return "ETIMEDOUT \(detail)"
        case .networkConnectionLost:
            return "ECONNRESET socket hang up (\(detail))"
        case .notConnectedToInternet, .internationalRoamingOff, .dataNotAllowed:
            return "ENETUNREACH \(detail)"
        case .cancelled:
            return "ECONNABORTED request aborted"
        case .serverCertificateHasBadDate:
            return "CERT_HAS_EXPIRED certificate has expired (\(detail))"
        case .serverCertificateNotYetValid:
            return "CERT_NOT_YET_VALID certificate is not yet valid (\(detail))"
        case .serverCertificateHasUnknownRoot:
            return "SELF_SIGNED_CERT_IN_CHAIN self-signed certificate in certificate chain (\(detail))"
        case .serverCertificateUntrusted:
            return "UNABLE_TO_VERIFY_LEAF_SIGNATURE unable to verify the first certificate (\(detail))"
        case .secureConnectionFailed, .clientCertificateRejected, .clientCertificateRequired:
            return "EPROTO \(detail)"
        case .appTransportSecurityRequiresSecureConnection:
            return "EPROTO App Transport Security blocked a cleartext request (\(detail))"
        default:
            return "ECONNRESET \(detail)"
        }
    }

    @objc(URLSession:dataTask:didReceiveResponse:completionHandler:)
    func urlSession(
        _ session: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
    ) {
        guard let entry = requests[dataTask.taskIdentifier], !entry.cancelled else {
            completionHandler(.cancel)
            return
        }
        entry.started = true
        let http = response as? HTTPURLResponse
        let status = http?.statusCode ?? 200
        var headers: [String: String] = [:]
        for (name, value) in http?.allHeaderFields ?? [:] {
            headers[String(describing: name).lowercased()] = String(describing: value)
        }
        plugin?.resolve(entry.call, [
            "status": status,
            "statusText": Self.statusText(status),
            "headers": headers,
            "url": response.url?.absoluteString ?? dataTask.originalRequest?.url?.absoluteString ?? "",
        ])
        completionHandler(.allow)
    }

    @objc(URLSession:dataTask:didReceiveData:)
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let entry = requests[dataTask.taskIdentifier], !entry.cancelled, !data.isEmpty else { return }
        plugin?.emit("httpData", ["id": entry.id, "dataB64": data.base64EncodedString()])
    }

    @objc(URLSession:task:willPerformHTTPRedirection:newRequest:completionHandler:)
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping @Sendable (URLRequest?) -> Void
    ) {
        // fetch `redirect: 'manual'`: hand the 3xx response itself back to JS.
        if let entry = requests[task.taskIdentifier], !entry.followRedirects {
            completionHandler(nil)
        } else {
            completionHandler(request)
        }
    }

    @objc(URLSession:task:didReceiveChallenge:completionHandler:)
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping @Sendable (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        // `ws` with `rejectUnauthorized: false` accepts any server certificate.
        if challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
           let socket = sockets[task.taskIdentifier], !socket.rejectUnauthorized,
           let trust = challenge.protectionSpace.serverTrust {
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }
        completionHandler(.performDefaultHandling, nil)
    }

    @objc(URLSession:task:didCompleteWithError:)
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let entry = requests.removeValue(forKey: task.taskIdentifier) {
            requestsById[entry.id] = nil
            if entry.cancelled { return }
            let url = task.originalRequest?.url
            if !entry.started {
                plugin?.reject(entry.call, error.map { Self.message(for: $0, url: url) } ?? "ECONNRESET socket hang up")
            } else if let error {
                plugin?.emit("httpError", ["id": entry.id, "message": Self.message(for: error, url: url)])
            } else {
                plugin?.emit("httpEnd", ["id": entry.id])
            }
            return
        }
        if let socket = sockets[task.taskIdentifier] {
            if let error, !socket.closed, socket.requestedClose == nil {
                finish(socket, code: 1006, reason: "", error: webSocketFailure(socket, error))
            } else {
                let close = socket.requestedClose ?? (1006, "")
                finish(socket, code: close.code, reason: close.reason, error: nil)
            }
        }
    }

    // MARK: WebSocket

    func webSocketConnect(_ call: CAPPluginCall) throws {
        guard let session else { throw MeshNetError("ERR_INVALID_STATE WebSocket session unavailable") }
        let id = try call.meshString("id")
        let urlText = try call.meshString("url")
        guard let url = URL(string: urlText), let scheme = url.scheme?.lowercased(), scheme == "ws" || scheme == "wss" else {
            throw MeshNetError("ERR_INVALID_URL Invalid WebSocket URL: \(urlText)")
        }
        var request = URLRequest(url: url)
        for (name, value) in call.meshHeaders("headers") {
            request.setValue(value, forHTTPHeaderField: name)
        }
        let protocols = (call.getArray("protocols") ?? []).compactMap { $0 as? String }.filter { !$0.isEmpty }
        if !protocols.isEmpty {
            request.setValue(protocols.joined(separator: ", "), forHTTPHeaderField: "Sec-WebSocket-Protocol")
        }
        let timeoutMs = call.meshInt("timeoutMs")
        if let timeoutMs, timeoutMs > 0 { request.timeoutInterval = Double(timeoutMs) / 1000 }
        let task = session.webSocketTask(with: request)
        task.maximumMessageSize = Self.maxWebSocketMessage
        let socket = WebSocket(id: id, task: task, rejectUnauthorized: call.meshBool("rejectUnauthorized") ?? true)
        sockets[task.taskIdentifier] = socket
        socketsById[id] = socket
        if let timeoutMs, timeoutMs > 0 {
            let timer = DispatchWorkItem { [weak self, weak socket] in
                guard let self, let socket, !socket.opened, !socket.closed else { return }
                socket.task.cancel()
                self.finish(socket, code: 1006, reason: "", error: "ETIMEDOUT Opening handshake has timed out")
            }
            socket.timer = timer
            queue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs), execute: timer)
        }
        task.resume()
        receive(socket)
    }

    private func webSocketFailure(_ socket: WebSocket, _ error: Error) -> String {
        if !socket.opened, let response = socket.task.response as? HTTPURLResponse {
            return "Unexpected server response: \(response.statusCode)"
        }
        return Self.message(for: error, url: socket.task.originalRequest?.url)
    }

    private func receive(_ socket: WebSocket) {
        socket.task.receive { [weak self, weak socket] result in
            guard let self else { return }
            // Hop explicitly so message order and socket state stay on the MeshNet queue.
            self.queue.async {
                guard let socket, !socket.closed else { return }
                switch result {
                case .success(.string(let text)):
                    self.plugin?.emit("wsMessage", ["id": socket.id, "text": text])
                    self.receive(socket)
                case .success(.data(let data)):
                    self.plugin?.emit("wsMessage", ["id": socket.id, "dataB64": data.base64EncodedString()])
                    self.receive(socket)
                case .success:
                    self.receive(socket)
                case .failure:
                    // The task's completion (didCompleteWithError / didCloseWith) reports the close.
                    break
                }
            }
        }
    }

    func webSocketSend(_ call: CAPPluginCall) throws {
        let id = try call.meshString("id")
        guard let socket = socketsById[id], socket.opened, !socket.closed else {
            throw MeshNetError("WebSocket is not open")
        }
        let message: URLSessionWebSocketTask.Message
        if let text = call.getString("text") {
            message = .string(text)
        } else {
            let data = try call.meshData("dataB64")
            message = .data(data)
        }
        socket.task.send(message) { [weak self] error in
            self?.queue.async {
                if let error {
                    self?.plugin?.reject(call, Self.message(for: error, url: socket.task.originalRequest?.url))
                } else {
                    self?.plugin?.resolve(call)
                }
            }
        }
    }

    func webSocketClose(id: String, code: Int, reason: String) {
        guard let socket = socketsById[id], !socket.closed else { return }
        socket.requestedClose = (code, reason)
        if socket.opened {
            let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
            socket.task.cancel(with: closeCode, reason: reason.data(using: .utf8))
        } else {
            socket.task.cancel()
            finish(socket, code: code, reason: reason, error: nil)
        }
    }

    @objc(URLSession:webSocketTask:didOpenWithProtocol:)
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard let socket = sockets[webSocketTask.taskIdentifier], !socket.closed else { return }
        socket.opened = true
        socket.timer?.cancel()
        socket.timer = nil
        var payload: [String: Any] = ["id": socket.id]
        if let negotiated = `protocol`, !negotiated.isEmpty { payload["protocol"] = negotiated }
        plugin?.emit("wsOpen", payload)
    }

    @objc(URLSession:webSocketTask:didCloseWithCode:reason:)
    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        guard let socket = sockets[webSocketTask.taskIdentifier] else { return }
        let text = reason.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        finish(socket, code: closeCode.rawValue, reason: text, error: nil)
    }

    /// Emits `wsError` (when failing) and `wsClose` exactly once, then forgets the socket.
    private func finish(_ socket: WebSocket, code: Int, reason: String, error: String?) {
        guard !socket.closed else { return }
        socket.closed = true
        socket.timer?.cancel()
        socket.timer = nil
        sockets[socket.task.taskIdentifier] = nil
        socketsById[socket.id] = nil
        if let error { plugin?.emit("wsError", ["id": socket.id, "message": error]) }
        plugin?.emit("wsClose", ["id": socket.id, "code": code, "reason": reason])
    }

    func shutdown() {
        session?.invalidateAndCancel()
        session = nil
    }
}
