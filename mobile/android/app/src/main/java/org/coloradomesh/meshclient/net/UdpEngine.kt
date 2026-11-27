package org.coloradomesh.meshclient.net

import android.annotation.SuppressLint
import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.EventSink
import org.coloradomesh.meshclient.bridge.Platform
import org.coloradomesh.meshclient.bridge.PluginError
import java.io.IOException
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.StandardProtocolFamily
import java.net.StandardSocketOptions
import java.nio.ByteBuffer
import java.nio.channels.ClosedChannelException
import java.nio.channels.DatagramChannel
import java.nio.channels.MembershipKey
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * MeshNet UDP (`dgram`): MeshCom EXTUDP, Reticulum AutoInterface probes, broadcast / multicast.
 *
 * Built on NIO `DatagramChannel`, not `DatagramSocket`: on Android `DatagramSocket.receive()`
 * holds the socket monitor while blocked, so `setBroadcast()` (also synchronized) would hang until
 * the next datagram arrives. Channel options take a separate lock from the blocking receive.
 *
 * Channels are created unbound so `reuseAddr` applies before bind; a send (or membership) before
 * bind binds to an ephemeral port first (Node implicit bind) and starts the receive loop.
 * [onMulticastNeeded] reports whether any open socket has broadcast enabled or a multicast
 * membership; the plugin holds a WifiManager.MulticastLock while that is true.
 */
class UdpEngine(private val sink: EventSink, private val onMulticastNeeded: (Boolean) -> Unit = {}) {
    private val sockets = ConcurrentHashMap<String, Udp>()
    private val threads: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "MeshNet-udp").apply { isDaemon = true } }
    private var multicastHeld = false

    fun create(id: String, type: String, reuseAddr: Boolean) {
        val v6 = type == "udp6"
        val ch = try {
            DatagramChannel.open(if (v6) StandardProtocolFamily.INET6 else StandardProtocolFamily.INET).apply {
                setOption(StandardSocketOptions.SO_REUSEADDR, reuseAddr)
            }
        } catch (e: IOException) {
            throw PluginError(NetErrors.describe(e, "socket", null), e)
        }
        sockets.put(id, Udp(id, ch, v6))?.close()
    }

    /** Blocking. */
    fun bind(id: String, port: Int, address: String): Map<String, Any?> {
        val u = get(id)
        u.bind(port, address)
        return u.boundInfo()
    }

    /** Blocking (address resolution + send). */
    fun send(id: String, data: ByteArray, port: Int, address: String) {
        val u = get(id)
        u.ensureBound()
        val dest = try {
            IpLiteral.parse(address) ?: InetAddress.getByName(address)
        } catch (e: IOException) {
            throw PluginError("ENOTFOUND getaddrinfo ENOTFOUND $address", e)
        }
        try {
            u.channel.send(ByteBuffer.wrap(data), InetSocketAddress(dest, port))
        } catch (e: IOException) {
            throw PluginError(NetErrors.describe(e, "send", NetErrors.target(address, port)), e)
        }
    }

    fun close(id: String) {
        sockets.remove(id)?.close()
        updateMulticast()
    }

    fun setOptions(id: String, broadcast: Boolean?, multicastTtl: Int?, multicastLoopback: Boolean?) {
        val u = get(id)
        try {
            if (broadcast != null) {
                u.channel.setOption(StandardSocketOptions.SO_BROADCAST, broadcast)
                u.broadcast = broadcast
            }
            if (multicastTtl != null) u.channel.setOption(StandardSocketOptions.IP_MULTICAST_TTL, multicastTtl)
            if (multicastLoopback != null) u.channel.setOption(StandardSocketOptions.IP_MULTICAST_LOOP, multicastLoopback)
        } catch (e: IOException) {
            throw PluginError(NetErrors.describe(e, "setsockopt", null), e)
        }
        updateMulticast()
    }

    /** Multicast membership uses NIO `MulticastChannel.join` (Android 8+, API 26). */
    @SuppressLint("NewApi")
    fun addMembership(id: String, group: String, iface: String?) {
        if (!Platform.atLeast(26)) throw PluginError("ENOSYS addMembership: multicast groups need Android 8 or newer")
        val u = get(id)
        u.ensureBound()
        try {
            val g = IpLiteral.parse(group) ?: InetAddress.getByName(group)
            val ni = networkInterface(iface, g is Inet6Address)
                ?: throw PluginError("ENODEV addMembership: no multicast-capable network interface")
            u.memberships[key(group, iface)]?.drop()
            u.memberships[key(group, iface)] = u.channel.join(g, ni)
        } catch (e: PluginError) {
            throw e
        } catch (e: IOException) {
            throw PluginError(NetErrors.describe(e, "addMembership", null), e)
        }
        updateMulticast()
    }

    @SuppressLint("NewApi") // memberships only exist on API 26+ (see addMembership)
    fun dropMembership(id: String, group: String, iface: String?) {
        val u = get(id)
        val k = u.memberships.remove(key(group, iface))
        updateMulticast()
        k?.drop() ?: throw PluginError("EADDRNOTAVAIL dropMembership EADDRNOTAVAIL")
    }

    fun shutdown() {
        sockets.values.forEach { it.close() }
        sockets.clear()
        updateMulticast()
        threads.shutdownNow()
    }

    private fun key(group: String, iface: String?) = "$group|${iface.orEmpty()}"

    private fun get(id: String): Udp = sockets[id] ?: throw PluginError("ERR_SOCKET_DGRAM_NOT_RUNNING Not running")

    /**
     * Node passes the interface as a local address (`192.168.1.5`, `::%wlan0`); without one the
     * first up, non-loopback, multicast-capable interface with an address of the group's family is
     * used (NIO needs an explicit interface where Node lets the kernel pick).
     */
    private fun networkInterface(iface: String?, v6: Boolean): NetworkInterface? {
        if (!iface.isNullOrBlank()) {
            val scope = iface.substringAfter('%', "")
            if (scope.isNotEmpty()) NetworkInterface.getByName(scope)?.let { return it }
            try {
                NetworkInterface.getByInetAddress(InetAddress.getByName(iface.substringBefore('%')))?.let { return it }
            } catch (_: IOException) {
                // fall through to the default interface
            }
        }
        val all = NetworkInterface.getNetworkInterfaces()?.toList().orEmpty()
        return all.firstOrNull { ni ->
            try {
                ni.isUp && !ni.isLoopback && ni.supportsMulticast() &&
                    ni.inetAddresses.toList().any { if (v6) it is Inet6Address else it is Inet4Address }
            } catch (_: IOException) {
                false
            }
        }
    }

    @Synchronized
    private fun updateMulticast() {
        val needed = sockets.values.any { it.broadcast || it.memberships.isNotEmpty() }
        if (needed != multicastHeld) {
            multicastHeld = needed
            onMulticastNeeded(needed)
        }
    }

    private inner class Udp(val id: String, val channel: DatagramChannel, val v6: Boolean) {
        private val closed = AtomicBoolean(false)
        private val receiving = AtomicBoolean(false)

        @Volatile
        var broadcast = false
        val memberships = ConcurrentHashMap<String, MembershipKey>()

        @Synchronized
        fun bind(port: Int, address: String) {
            if (channel.localAddress != null) throw PluginError("ERR_SOCKET_ALREADY_BOUND Socket is already bound")
            try {
                val addr = IpLiteral.parse(address) ?: InetAddress.getByName(address)
                channel.bind(InetSocketAddress(addr, port))
            } catch (e: IOException) {
                throw PluginError(NetErrors.describe(e, "bind", NetErrors.target(address, port)), e)
            }
            if (receiving.compareAndSet(false, true)) threads.execute { receiveLoop() }
        }

        @Synchronized
        fun ensureBound() {
            if (channel.localAddress == null) bind(0, if (v6) "::" else "0.0.0.0")
        }

        fun boundInfo(): Map<String, Any?> {
            val local = channel.localAddress as? InetSocketAddress
            return mapOf(
                "address" to (local?.address?.hostAddress ?: if (v6) "::" else "0.0.0.0"),
                "port" to (local?.port ?: 0),
            )
        }

        private fun receiveLoop() {
            val buf = ByteBuffer.allocate(MAX_DATAGRAM)
            while (!closed.get()) {
                try {
                    buf.clear()
                    val from = channel.receive(buf) as? InetSocketAddress ?: continue
                    buf.flip()
                    sink.emit(
                        "udpMessage",
                        mapOf(
                            "id" to id,
                            "dataB64" to Codec.b64(buf.array(), 0, buf.limit()),
                            "address" to from.address.hostAddress,
                            "port" to from.port,
                        ),
                    )
                } catch (e: ClosedChannelException) {
                    return
                } catch (e: IOException) {
                    if (closed.get()) return
                    sink.emit("udpError", mapOf("id" to id, "message" to NetErrors.describe(e, "recvmsg", null)))
                    return
                }
            }
        }

        fun close() {
            if (closed.compareAndSet(false, true)) {
                memberships.clear()
                try {
                    channel.close()
                } catch (_: IOException) {
                    // already closed
                }
            }
        }
    }

    companion object {
        private const val MAX_DATAGRAM = 65_535
    }
}
