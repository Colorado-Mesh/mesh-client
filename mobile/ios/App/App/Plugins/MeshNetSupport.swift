import Capacitor
import Darwin
import Foundation
import Network

/// Error whose message goes to JS verbatim. Socket, DNS and TLS failures start with the Node error
/// code (`ECONNREFUSED connect ECONNREFUSED 10.0.0.2:4403`) so the host shims can set `err.code`
/// (see `mobile/src/native/contracts.ts`).
struct MeshNetError: Error, CustomStringConvertible {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var description: String { message }

    static func text(_ error: Error) -> String {
        if let mesh = error as? MeshNetError { return mesh.message }
        return error.localizedDescription
    }
}

// MARK: - errno / NWError → Node error codes

enum MeshErrno {
    static func name(_ code: Int32) -> String {
        switch code {
        case EPERM: return "EPERM"
        case ENOENT: return "ENOENT"
        case EINTR: return "EINTR"
        case EBADF: return "EBADF"
        case EACCES: return "EACCES"
        case EINVAL: return "EINVAL"
        case EPIPE: return "EPIPE"
        case EAGAIN: return "EAGAIN"
        case EMSGSIZE: return "EMSGSIZE"
        case EPROTONOSUPPORT: return "EPROTONOSUPPORT"
        case EAFNOSUPPORT: return "EAFNOSUPPORT"
        case EADDRINUSE: return "EADDRINUSE"
        case EADDRNOTAVAIL: return "EADDRNOTAVAIL"
        case ENETDOWN: return "ENETDOWN"
        case ENETUNREACH: return "ENETUNREACH"
        case ENETRESET: return "ENETRESET"
        case ECONNABORTED: return "ECONNABORTED"
        case ECONNRESET: return "ECONNRESET"
        case ENOBUFS: return "ENOBUFS"
        case EISCONN: return "EISCONN"
        case ENOTCONN: return "ENOTCONN"
        case ETIMEDOUT: return "ETIMEDOUT"
        case ECONNREFUSED: return "ECONNREFUSED"
        case EHOSTDOWN: return "EHOSTDOWN"
        case EHOSTUNREACH: return "EHOSTUNREACH"
        case EPROTO: return "EPROTO"
        case ENOTSUP: return "ENOTSUP"
        case ECANCELED: return "ECANCELED"
        default: return "EIO"
        }
    }

    /// Node-style message: `"EADDRINUSE bind EADDRINUSE 0.0.0.0:1799"`.
    static func message(_ code: Int32, syscall: String, target: String? = nil) -> String {
        let name = name(code)
        let detail = String(cString: strerror(code))
        if let target { return "\(name) \(syscall) \(name) \(target) (\(detail))" }
        return "\(name) \(syscall) \(name) (\(detail))"
    }
}

enum MeshNWError {
    /// Maps a Network.framework error to a Node-style message for `syscall` against `host[:port]`.
    static func message(_ error: NWError, syscall: String, host: String?, port: Int?) -> String {
        let target: String? = host.map { h in port.map { "\(h):\($0)" } ?? h }
        switch error {
        case .posix(let code):
            return MeshErrno.message(code.rawValue, syscall: syscall, target: target)
        case .dns(let code):
            // kDNSServiceErr_Timeout (-65568) is a temporary failure; everything else means the
            // name does not resolve (NoSuchName -65538, NoSuchRecord -65554, …).
            let name = host ?? ""
            if code == -65568 { return "EAI_AGAIN getaddrinfo EAI_AGAIN \(name)" }
            return "ENOTFOUND getaddrinfo ENOTFOUND \(name) (DNS error \(code))"
        case .tls(let status):
            return MeshTls.message(forStatus: status)
        default:
            return "ECONNRESET \(syscall) ECONNRESET \(target ?? "") (\(error.debugDescription))"
        }
    }
}

// MARK: - Addresses

enum MeshAddress {
    static func ntop(_ family: Int32, _ bytes: Data) -> String? {
        var buffer = [CChar](repeating: 0, count: Int(INET6_ADDRSTRLEN) + 1)
        let size = socklen_t(buffer.count)
        let ok = bytes.withUnsafeBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return false }
            return inet_ntop(family, base, &buffer, size) != nil
        }
        return ok ? String(cString: buffer) : nil
    }

    static func hostString(_ host: NWEndpoint.Host) -> String {
        switch host {
        case .ipv4(let address):
            return ntop(AF_INET, address.rawValue) ?? "\(address)"
        case .ipv6(let address):
            var text = ntop(AF_INET6, address.rawValue) ?? "\(address)"
            if let iface = address.interface { text += "%\(iface.name)" }
            return text
        case .name(let name, _):
            return name
        @unknown default:
            return "\(host)"
        }
    }

    static func split(_ endpoint: NWEndpoint?) -> (address: String, port: Int)? {
        guard let endpoint, case let .hostPort(host, port) = endpoint else { return nil }
        return (hostString(host), Int(port.rawValue))
    }

    static func family(of address: String) -> String {
        address.contains(":") ? "IPv6" : "IPv4"
    }

    static func isIPLiteral(_ text: String) -> Bool {
        let bare = text.split(separator: "%", maxSplits: 1).first.map(String.init) ?? text
        return IPv4Address(bare) != nil || IPv6Address(bare) != nil
    }

    /// `localAddress`/`remoteAddress` fields of `TcpConnectResult` for an established connection.
    static func connectionInfo(_ connection: NWConnection) -> [String: Any] {
        var info: [String: Any] = [:]
        let path = connection.currentPath
        if let local = split(path?.localEndpoint) {
            info["localAddress"] = local.address
            info["localPort"] = local.port
        }
        if let remote = split(path?.remoteEndpoint) ?? split(connection.endpoint) {
            info["remoteAddress"] = remote.address
            info["remotePort"] = remote.port
            info["remoteFamily"] = family(of: remote.address)
        }
        return info
    }
}

/// BSD `sockaddr` helpers for the UDP sockets and DNS results.
enum MeshSockaddr {
    typealias Described = (address: String, port: Int, family: Int)

    /// Formats an IPv4/IPv6 socket address (link-local IPv6 keeps its `%iface` scope like Node).
    static func describe(_ sa: UnsafePointer<sockaddr>) -> Described? {
        switch Int32(sa.pointee.sa_family) {
        case AF_INET:
            return sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { sin -> Described? in
                var addr = sin.pointee.sin_addr
                let bytes = withUnsafeBytes(of: &addr) { Data($0) }
                guard let text = MeshAddress.ntop(AF_INET, bytes) else { return nil }
                return (text, Int(UInt16(bigEndian: sin.pointee.sin_port)), 4)
            }
        case AF_INET6:
            return sa.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { sin6 -> Described? in
                var addr = sin6.pointee.sin6_addr
                let bytes = withUnsafeBytes(of: &addr) { Data($0) }
                guard var text = MeshAddress.ntop(AF_INET6, bytes) else { return nil }
                let scope = sin6.pointee.sin6_scope_id
                if scope != 0 {
                    var name = [CChar](repeating: 0, count: Int(IF_NAMESIZE) + 1)
                    if if_indextoname(scope, &name) != nil { text += "%" + String(cString: name) }
                }
                return (text, Int(UInt16(bigEndian: sin6.pointee.sin6_port)), 6)
            }
        default:
            return nil
        }
    }

    /// Splits `fe80::1%en0` into the address and the interface index.
    static func splitScope(_ address: String) -> (host: String, scope: UInt32) {
        guard let pct = address.firstIndex(of: "%") else { return (address, 0) }
        let iface = String(address[address.index(after: pct)...])
        let host = String(address[..<pct])
        if let index = UInt32(iface) { return (host, index) }
        return (host, if_nametoindex(iface))
    }

    static func isNumeric(_ address: String) -> Bool {
        let host = splitScope(address).host
        var v4 = in_addr()
        var v6 = in6_addr()
        return inet_pton(AF_INET, host, &v4) == 1 || inet_pton(AF_INET6, host, &v6) == 1
    }

    /// Builds a socket address for `family` (an IPv4 literal on an AF_INET6 socket becomes the
    /// IPv4-mapped `::ffff:a.b.c.d`, as Node does for dual-stack `udp6` sockets).
    static func make(address: String, port: UInt16, family: Int32) throws -> (sockaddr_storage, socklen_t) {
        var storage = sockaddr_storage()
        let (host, scope) = splitScope(address)
        if family == AF_INET {
            var addr = in_addr()
            guard inet_pton(AF_INET, host, &addr) == 1 else {
                throw MeshNetError("EINVAL invalid IPv4 address \(address)")
            }
            withUnsafeMutablePointer(to: &storage) { pointer in
                pointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { sin in
                    sin.pointee.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
                    sin.pointee.sin_family = sa_family_t(AF_INET)
                    sin.pointee.sin_port = port.bigEndian
                    sin.pointee.sin_addr = addr
                }
            }
            return (storage, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
        var addr6 = in6_addr()
        if inet_pton(AF_INET6, host, &addr6) != 1 {
            var addr4 = in_addr()
            guard inet_pton(AF_INET, host, &addr4) == 1, inet_pton(AF_INET6, "::ffff:" + host, &addr6) == 1 else {
                throw MeshNetError("EINVAL invalid IP address \(address)")
            }
        }
        withUnsafeMutablePointer(to: &storage) { pointer in
            pointer.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { sin6 in
                sin6.pointee.sin6_len = UInt8(MemoryLayout<sockaddr_in6>.size)
                sin6.pointee.sin6_family = sa_family_t(AF_INET6)
                sin6.pointee.sin6_port = port.bigEndian
                sin6.pointee.sin6_addr = addr6
                sin6.pointee.sin6_scope_id = scope
            }
        }
        return (storage, socklen_t(MemoryLayout<sockaddr_in6>.size))
    }
}

// MARK: - DNS

enum MeshDNS {
    /// Blocking `getaddrinfo`; callers run it on a background queue, never on the bridge queue.
    static func lookup(_ hostname: String, family: Int) -> Result<[[String: Any]], MeshNetError> {
        var hints = addrinfo()
        hints.ai_family = family == 4 ? AF_INET : (family == 6 ? AF_INET6 : AF_UNSPEC)
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        let rc = getaddrinfo(hostname, nil, &hints, &result)
        guard rc == 0, let first = result else {
            let detail = String(cString: gai_strerror(rc))
            if rc == EAI_AGAIN {
                return .failure(MeshNetError("EAI_AGAIN getaddrinfo EAI_AGAIN \(hostname) (\(detail))"))
            }
            return .failure(MeshNetError("ENOTFOUND getaddrinfo ENOTFOUND \(hostname) (\(detail))"))
        }
        defer { freeaddrinfo(first) }
        var addresses: [[String: Any]] = []
        var seen = Set<String>()
        var cursor: UnsafeMutablePointer<addrinfo>? = first
        while let entry = cursor {
            if let sa = entry.pointee.ai_addr, let described = MeshSockaddr.describe(UnsafePointer(sa)) {
                if seen.insert(described.address).inserted {
                    addresses.append(["address": described.address, "family": described.family])
                }
            }
            cursor = entry.pointee.ai_next
        }
        if addresses.isEmpty {
            return .failure(MeshNetError("ENOTFOUND getaddrinfo ENOTFOUND \(hostname)"))
        }
        return .success(addresses)
    }
}

// MARK: - Plugin call arguments

extension CAPPluginCall {
    func meshString(_ key: String) throws -> String {
        guard let value = getString(key), !value.isEmpty else {
            throw MeshNetError("ERR_INVALID_ARG_TYPE missing \(key)")
        }
        return value
    }

    func meshNumber(_ key: String) -> Double? {
        (getValue(key) as? NSNumber)?.doubleValue
    }

    func meshInt(_ key: String) -> Int? {
        guard let number = meshNumber(key), number.isFinite else { return nil }
        return Int(number)
    }

    func meshBool(_ key: String) -> Bool? {
        getValue(key) as? Bool
    }

    func meshPort(_ key: String) throws -> UInt16 {
        guard let number = meshNumber(key), number >= 0, number <= 65535, number == number.rounded() else {
            throw MeshNetError("ERR_SOCKET_BAD_PORT \(key) should be >= 0 and < 65536")
        }
        return UInt16(number)
    }

    func meshData(_ key: String) throws -> Data {
        let text = getString(key) ?? ""
        guard let data = Data(base64Encoded: text) else {
            throw MeshNetError("ERR_INVALID_ARG_VALUE \(key) is not valid base64")
        }
        return data
    }

    /// `string | string[]` base64 values (`caB64`).
    func meshBase64List(_ key: String) -> [String] {
        if let single = getString(key) { return single.isEmpty ? [] : [single] }
        if let list = getArray(key) { return list.compactMap { $0 as? String }.filter { !$0.isEmpty } }
        return []
    }

    func meshHeaders(_ key: String) -> [String: String] {
        var headers: [String: String] = [:]
        for (name, value) in getObject(key) ?? [:] {
            if let text = value as? String {
                headers[name] = text
            } else if let number = value as? NSNumber {
                headers[name] = number.stringValue
            }
        }
        return headers
    }
}

extension JSObject {
    func meshString(_ key: String) -> String? {
        guard let value = self[key] as? String, !value.isEmpty else { return nil }
        return value
    }

    func meshBool(_ key: String) -> Bool? {
        self[key] as? Bool
    }

    func meshBase64List(_ key: String) -> [String] {
        if let single = self[key] as? String { return single.isEmpty ? [] : [single] }
        if let list = self[key] as? JSArray { return list.compactMap { $0 as? String }.filter { !$0.isEmpty } }
        return []
    }
}
