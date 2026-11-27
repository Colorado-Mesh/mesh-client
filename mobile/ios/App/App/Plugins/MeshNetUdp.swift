import Darwin
import Foundation

/// `dgram`-style UDP socket over a BSD socket: one fd that can bind, `sendto` any address and
/// receive from anyone, which per-peer `NWConnection`s cannot model. Reads come from a
/// `DispatchSourceRead` on the plugin's serial queue; every method runs on that queue.
///
/// iOS limitation: sending to or receiving from multicast **and broadcast** addresses requires the
/// `com.apple.developer.networking.multicast` entitlement (Apple grants it on request). Without it
/// `sendto` to a broadcast/multicast address fails (typically `EHOSTUNREACH`/`EPERM`) and group
/// traffic is not delivered; those errors are reported to JS unchanged. Unicast works with the
/// Local Network permission (`NSLocalNetworkUsageDescription`).
final class MeshUdpSocket {
    let id: String
    private let fd: Int32
    private let family: Int32
    private weak var plugin: MeshNetPlugin?
    private var source: DispatchSourceRead?
    private var closed = false

    var isIPv6: Bool { family == AF_INET6 }

    init(id: String, ipv6: Bool, reuseAddr: Bool, plugin: MeshNetPlugin) throws {
        let family = ipv6 ? AF_INET6 : AF_INET
        let fd = Darwin.socket(family, SOCK_DGRAM, IPPROTO_UDP)
        guard fd >= 0 else { throw MeshNetError(MeshErrno.message(errno, syscall: "socket")) }
        self.id = id
        self.plugin = plugin
        self.family = family
        self.fd = fd
        var on: Int32 = 1
        let size = socklen_t(MemoryLayout<Int32>.size)
        // Never raise SIGPIPE in the app process.
        _ = setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, size)
        if reuseAddr {
            // libuv sets SO_REUSEPORT as well on Darwin so several sockets can share a port.
            _ = setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, size)
            _ = setsockopt(fd, SOL_SOCKET, SO_REUSEPORT, &on, size)
        }
        if ipv6 {
            var off: Int32 = 0
            _ = setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, size)
        }
        let flags = fcntl(fd, F_GETFL)
        _ = fcntl(fd, F_SETFL, flags | O_NONBLOCK)
    }

    func start(queue: DispatchQueue) {
        let fd = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: queue)
        source.setEventHandler { [weak self] in self?.drain() }
        source.setCancelHandler { _ = Darwin.close(fd) }
        self.source = source
        source.resume()
    }

    private func drain() {
        var buffer = [UInt8](repeating: 0, count: 65_536)
        while !closed {
            var storage = sockaddr_storage()
            var length = socklen_t(MemoryLayout<sockaddr_storage>.size)
            let fd = fd
            let (count, error) = buffer.withUnsafeMutableBytes { bytes -> (Int, Int32) in
                withUnsafeMutablePointer(to: &storage) { pointer -> (Int, Int32) in
                    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa -> (Int, Int32) in
                        let n = recvfrom(fd, bytes.baseAddress, bytes.count, 0, sa, &length)
                        return (n, n < 0 ? errno : 0)
                    }
                }
            }
            if count < 0 {
                if error == EINTR { continue }
                if error == EAGAIN { return }
                plugin?.emit("udpError", ["id": id, "message": MeshErrno.message(error, syscall: "recvmsg")])
                return
            }
            let sender = withUnsafePointer(to: &storage) { pointer -> MeshSockaddr.Described? in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { MeshSockaddr.describe($0) }
            }
            plugin?.emit("udpMessage", [
                "id": id,
                "dataB64": Data(buffer[0 ..< count]).base64EncodedString(),
                "address": sender?.address ?? "",
                "port": sender?.port ?? 0,
            ])
        }
    }

    private func localAddress() -> [String: Any] {
        var storage = sockaddr_storage()
        var length = socklen_t(MemoryLayout<sockaddr_storage>.size)
        let fd = fd
        let described = withUnsafeMutablePointer(to: &storage) { pointer -> MeshSockaddr.Described? in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa -> MeshSockaddr.Described? in
                getsockname(fd, sa, &length) == 0 ? MeshSockaddr.describe(UnsafePointer(sa)) : nil
            }
        }
        return ["address": described?.address ?? (family == AF_INET6 ? "::" : "0.0.0.0"), "port": described?.port ?? 0]
    }

    func bind(address: String, port: UInt16) throws -> [String: Any] {
        let made = try MeshSockaddr.make(address: address, port: port, family: family)
        var storage = made.0
        let length = made.1
        let fd = fd
        let (rc, error) = withUnsafePointer(to: &storage) { pointer -> (Int32, Int32) in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa -> (Int32, Int32) in
                let rc = Darwin.bind(fd, sa, length)
                return (rc, rc != 0 ? errno : 0)
            }
        }
        if rc != 0 {
            throw MeshNetError(MeshErrno.message(error, syscall: "bind", target: "\(address):\(port)"))
        }
        return localAddress()
    }

    func send(_ data: Data, address: String, port: UInt16) throws {
        guard !closed else { throw MeshNetError("ERR_SOCKET_DGRAM_NOT_RUNNING Not running") }
        let made = try MeshSockaddr.make(address: address, port: port, family: family)
        var storage = made.0
        let length = made.1
        let fd = fd
        let (sent, error) = data.withUnsafeBytes { bytes -> (Int, Int32) in
            withUnsafePointer(to: &storage) { pointer -> (Int, Int32) in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa -> (Int, Int32) in
                    let n = sendto(fd, bytes.baseAddress, bytes.count, 0, sa, length)
                    return (n, n < 0 ? errno : 0)
                }
            }
        }
        if sent < 0 {
            throw MeshNetError(MeshErrno.message(error, syscall: "send", target: "\(address):\(port)"))
        }
    }

    private func check(_ rc: Int32, _ what: String) throws {
        if rc != 0 { throw MeshNetError(MeshErrno.message(errno, syscall: what)) }
    }

    func setBroadcast(_ enabled: Bool) throws {
        var value: Int32 = enabled ? 1 : 0
        try check(setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &value, socklen_t(MemoryLayout<Int32>.size)), "setBroadcast")
    }

    func setMulticastTTL(_ ttl: Int) throws {
        if family == AF_INET {
            // Darwin takes u_char for the IPv4 multicast options.
            var value = UInt8(clamping: ttl)
            try check(setsockopt(fd, IPPROTO_IP, IP_MULTICAST_TTL, &value, socklen_t(MemoryLayout<UInt8>.size)), "setMulticastTTL")
        } else {
            var value = Int32(clamping: ttl)
            try check(setsockopt(fd, IPPROTO_IPV6, IPV6_MULTICAST_HOPS, &value, socklen_t(MemoryLayout<Int32>.size)), "setMulticastTTL")
        }
    }

    func setMulticastLoopback(_ enabled: Bool) throws {
        if family == AF_INET {
            var value: UInt8 = enabled ? 1 : 0
            try check(setsockopt(fd, IPPROTO_IP, IP_MULTICAST_LOOP, &value, socklen_t(MemoryLayout<UInt8>.size)), "setMulticastLoopback")
        } else {
            var value: UInt32 = enabled ? 1 : 0
            try check(setsockopt(fd, IPPROTO_IPV6, IPV6_MULTICAST_LOOP, &value, socklen_t(MemoryLayout<UInt32>.size)), "setMulticastLoopback")
        }
    }

    /// `addMembership` / `dropMembership`. Best effort on iOS: needs the multicast entitlement.
    func membership(group: String, iface: String?, join: Bool) throws {
        let what = join ? "addMembership" : "dropMembership"
        if family == AF_INET {
            var request = ip_mreq()
            guard inet_pton(AF_INET, group, &request.imr_multiaddr) == 1 else {
                throw MeshNetError("EINVAL \(what) EINVAL invalid IPv4 group \(group)")
            }
            if let iface, inet_pton(AF_INET, iface, &request.imr_interface) == 1 {
                // explicit interface address
            } else {
                request.imr_interface = in_addr(s_addr: 0) // INADDR_ANY
            }
            let option = join ? IP_ADD_MEMBERSHIP : IP_DROP_MEMBERSHIP
            try check(setsockopt(fd, IPPROTO_IP, option, &request, socklen_t(MemoryLayout<ip_mreq>.size)), what)
        } else {
            let (host, groupScope) = MeshSockaddr.splitScope(group)
            var request = ipv6_mreq()
            guard inet_pton(AF_INET6, host, &request.ipv6mr_multiaddr) == 1 else {
                throw MeshNetError("EINVAL \(what) EINVAL invalid IPv6 group \(group)")
            }
            var index = groupScope
            if let iface, !iface.isEmpty {
                // Node accepts "::%en0" or an interface name.
                let scoped = MeshSockaddr.splitScope(iface.contains("%") ? iface : "::%" + iface)
                if scoped.scope != 0 { index = scoped.scope }
            }
            request.ipv6mr_interface = index
            let option = join ? IPV6_JOIN_GROUP : IPV6_LEAVE_GROUP
            try check(setsockopt(fd, IPPROTO_IPV6, option, &request, socklen_t(MemoryLayout<ipv6_mreq>.size)), what)
        }
    }

    func close() {
        guard !closed else { return }
        closed = true
        source?.cancel() // the cancel handler closes the fd
        source = nil
    }
}
