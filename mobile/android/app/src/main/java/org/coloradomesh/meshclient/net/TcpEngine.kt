package org.coloradomesh.meshclient.net

import android.annotation.SuppressLint
import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.EventSink
import org.coloradomesh.meshclient.bridge.Platform
import org.coloradomesh.meshclient.bridge.PluginError
import java.io.IOException
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.UnknownHostException
import java.security.cert.X509Certificate
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import javax.net.ssl.SNIHostName
import javax.net.ssl.SSLParameters
import javax.net.ssl.SSLServerSocket
import javax.net.ssl.SSLSocket

data class TcpConnectOptions(
    val id: String,
    val host: String,
    val port: Int,
    val tls: Boolean = false,
    val servername: String? = null,
    val rejectUnauthorized: Boolean = true,
    val material: TlsMaterial = TlsMaterial(),
    val alpn: List<String> = emptyList(),
    val noDelay: Boolean = true,
    val keepAlive: Boolean = false,
    val timeoutMs: Int = DEFAULT_CONNECT_TIMEOUT_MS,
) {
    companion object {
        const val DEFAULT_CONNECT_TIMEOUT_MS = 20_000
    }
}

data class TcpServerTls(val material: TlsMaterial, val requestCert: Boolean, val rejectUnauthorized: Boolean)

data class TcpListenOptions(val id: String, val host: String, val port: Int, val tls: TcpServerTls? = null)

/**
 * MeshNet TCP/TLS sockets on java.net / JSSE (Conscrypt on Android). Pure JVM so it is tested with
 * real loopback sockets. Semantics follow `scripts/mobile-web-bridge.mjs` (Node `net` / `tls`):
 * - one reader thread per socket emits `tcpData`, `tcpEnd` (peer FIN);
 * - writes run on a per-socket single-thread executor, so they stay ordered and each `tcpWrite`
 *   resolves only after its bytes reached the kernel;
 * - `tcpClose` fires exactly once per established socket, with `error` when an I/O error closed it;
 * - `tcpEnd` from the caller half-closes after queued writes (TLS sockets that cannot half-close
 *   are closed instead); once both directions are done the socket closes.
 */
class TcpEngine(private val sink: EventSink) {
    private val conns = ConcurrentHashMap<String, Conn>()
    private val connecting = ConcurrentHashMap<String, Socket>()
    private val cancelled: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val servers = ConcurrentHashMap<String, Server>()
    private val threads: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "MeshNet-tcp").apply { isDaemon = true } }
    private val acceptSeq = AtomicLong()

    /** Blocking: run on a worker thread. [onConnected] resolves the call before reads start. */
    fun connect(o: TcpConnectOptions, onConnected: (Map<String, Any?>) -> Unit) {
        val target = NetErrors.target(o.host, o.port)
        val timeout = if (o.timeoutMs > 0) o.timeoutMs else TcpConnectOptions.DEFAULT_CONNECT_TIMEOUT_MS
        val deadline = System.currentTimeMillis() + timeout
        cancelled.remove(o.id)
        val addresses = try {
            IpLiteral.parse(o.host)?.let { listOf(it) } ?: InetAddress.getAllByName(o.host).toList()
        } catch (e: UnknownHostException) {
            throw PluginError("ENOTFOUND getaddrinfo ENOTFOUND ${o.host}", e)
        }
        var socket: Socket? = null
        var lastError: Exception? = null
        for (address in addresses) {
            val s = Socket()
            connecting[o.id] = s
            try {
                s.tcpNoDelay = o.noDelay
                s.keepAlive = o.keepAlive
                val remaining = (deadline - System.currentTimeMillis()).coerceAtLeast(1L).toInt()
                s.connect(InetSocketAddress(address, o.port), remaining)
                socket = s
                break
            } catch (e: IOException) {
                closeQuietly(s)
                lastError = e
                if (cancelled.contains(o.id) || System.currentTimeMillis() >= deadline) break
            }
        }
        connecting.remove(o.id)
        if (cancelled.remove(o.id)) {
            closeQuietly(socket)
            throw PluginError("ECONNABORTED socket destroyed while connecting")
        }
        if (socket == null) throw PluginError(NetErrors.describe(lastError ?: IOException("connect failed"), "connect", target), lastError)

        var info: Map<String, Any?>
        val active: Socket = if (o.tls) {
            try {
                val (ssl, tlsInfo) = startClientTls(socket, o, deadline)
                info = tlsInfo
                ssl
            } catch (e: PluginError) {
                closeQuietly(socket)
                throw e
            } catch (e: Exception) {
                closeQuietly(socket)
                throw PluginError(NetErrors.describe(e, "connect", target), e)
            }
        } else {
            info = emptyMap()
            socket
        }
        val conn = Conn(o.id, active)
        conns.put(o.id, conn)?.destroy()
        onConnected(addressInfo(active) + info)
        conn.startReader()
    }

    private fun startClientTls(raw: Socket, o: TcpConnectOptions, deadline: Long): Pair<SSLSocket, Map<String, Any?>> {
        val trust = RecordingTrustManager(TlsSupport.baseTrustManager(o.material.ca), o.rejectUnauthorized)
        val ctx = TlsSupport.context(TlsSupport.keyManagers(o.material), trust)
        val name = o.servername?.takeIf { it.isNotEmpty() } ?: o.host
        val sni = name.takeIf { !IpLiteral.isIp(it) }
        val ssl = ctx.socketFactory.createSocket(raw, sni ?: o.host, o.port, true) as SSLSocket
        val params = ssl.sslParameters
        if (sni != null) params.serverNames = listOf(SNIHostName(sni))
        if (o.alpn.isNotEmpty()) setAlpn(params, o.alpn)
        ssl.sslParameters = params
        ssl.soTimeout = (deadline - System.currentTimeMillis()).coerceAtLeast(1L).toInt()
        ssl.startHandshake()
        ssl.soTimeout = 0
        var authorized = trust.verified
        var authError = trust.failureCode
        val leaf = ssl.session.peerCertificates.firstOrNull() as? X509Certificate
        val mismatch = leaf?.let { HostnameCheck.check(name, it) }
        if (mismatch != null) {
            if (o.rejectUnauthorized) throw PluginError(mismatch)
            authorized = false
            if (authError == null) authError = "ERR_TLS_CERT_ALTNAME_INVALID"
        }
        val alpn = negotiatedAlpn(ssl)
        return ssl to mapOf("authorized" to authorized, "authorizationError" to authError, "alpnProtocol" to alpn)
    }

    /** ALPN needs Android 10+ (API 29); older devices connect without it. */
    @SuppressLint("NewApi")
    private fun setAlpn(params: SSLParameters, alpn: List<String>) {
        if (Platform.atLeast(29)) params.applicationProtocols = alpn.toTypedArray()
    }

    @SuppressLint("NewApi")
    private fun negotiatedAlpn(ssl: SSLSocket): String? =
        if (Platform.atLeast(29)) ssl.applicationProtocol?.takeIf { it.isNotEmpty() } else null

    fun write(id: String, bytes: ByteArray, done: (Throwable?) -> Unit) {
        val c = conns[id]
        if (c == null) {
            done(PluginError("EPIPE write EPIPE (socket closed)"))
            return
        }
        c.write(bytes, done)
    }

    fun end(id: String, done: (Throwable?) -> Unit) {
        val c = conns[id]
        if (c == null) done(null) else c.end(done)
    }

    fun destroy(id: String) {
        conns[id]?.destroy()
        connecting[id]?.let { s ->
            cancelled.add(id)
            closeQuietly(s)
        }
    }

    fun setOptions(id: String, noDelay: Boolean?, keepAlive: Boolean?) {
        val s = conns[id]?.socket ?: return
        try {
            if (noDelay != null) s.tcpNoDelay = noDelay
            if (keepAlive != null) s.keepAlive = keepAlive
        } catch (_: IOException) {
            // Socket already closing; Node ignores option changes on dead sockets.
        }
    }

    // ── Servers ─────────────────────────────────────────────────────────────

    /** Blocking bind; accepted connections emit `tcpAccept` (TLS ones after the handshake). */
    fun listen(o: TcpListenOptions): Map<String, Any?> {
        val host = o.host.ifEmpty { "127.0.0.1" }
        val tls = o.tls
        var verifier: X509TrustManagerHolder? = null
        val ss: ServerSocket = if (tls != null) {
            val base = TlsSupport.baseTrustManager(tls.material.ca)
            val trust = RecordingTrustManager(base, tls.rejectUnauthorized)
            val km = TlsSupport.keyManagers(tls.material) ?: throw PluginError("ERR_SSL_NO_CERTIFICATE a TLS server needs a certificate and key")
            verifier = X509TrustManagerHolder(base)
            val sss = TlsSupport.context(km, trust).serverSocketFactory.createServerSocket() as SSLServerSocket
            if (tls.requestCert && tls.rejectUnauthorized) sss.needClientAuth = true else if (tls.requestCert) sss.wantClientAuth = true
            sss
        } else {
            ServerSocket()
        }
        try {
            ss.reuseAddress = true
            val addr = IpLiteral.parse(host) ?: InetAddress.getByName(host)
            ss.bind(InetSocketAddress(addr, o.port), 64)
        } catch (e: IOException) {
            closeQuietly(ss)
            throw PluginError(NetErrors.describe(e, "listen", NetErrors.target(host, o.port)), e)
        }
        val server = Server(o.id, ss, tls, verifier)
        servers.put(o.id, server)?.close()
        threads.execute { server.acceptLoop() }
        return mapOf("port" to ss.localPort, "host" to (ss.inetAddress?.hostAddress ?: host))
    }

    fun serverClose(id: String) {
        servers.remove(id)?.close()
    }

    fun shutdown() {
        servers.values.forEach { it.close() }
        servers.clear()
        conns.values.forEach { it.destroy() }
        connecting.values.forEach { closeQuietly(it) }
        threads.shutdownNow()
    }

    private class X509TrustManagerHolder(val base: javax.net.ssl.X509TrustManager)

    private inner class Server(val id: String, val ss: ServerSocket, val tls: TcpServerTls?, val verifier: X509TrustManagerHolder?) {
        private val closed = AtomicBoolean(false)

        fun acceptLoop() {
            while (!closed.get()) {
                val s = try {
                    ss.accept()
                } catch (_: IOException) {
                    break // closed
                }
                try {
                    threads.execute { adopt(s) }
                } catch (_: RejectedExecutionException) {
                    closeQuietly(s)
                }
            }
        }

        private fun adopt(s: Socket) {
            val connId = "$id:${acceptSeq.incrementAndGet()}"
            var extra: Map<String, Any?> = emptyMap()
            try {
                s.tcpNoDelay = true
                if (s is SSLSocket) {
                    s.soTimeout = TcpConnectOptions.DEFAULT_CONNECT_TIMEOUT_MS
                    s.startHandshake()
                    s.soTimeout = 0
                    extra = mapOf("authorized" to clientAuthorized(s))
                }
            } catch (_: IOException) {
                closeQuietly(s) // failed handshake: Node emits tlsClientError, never 'secureConnection'
                return
            }
            if (closed.get()) {
                closeQuietly(s)
                return
            }
            val conn = Conn(connId, s)
            conns[connId] = conn
            sink.emit("tcpAccept", mapOf("serverId" to id, "id" to connId) + addressInfo(s) + extra)
            conn.startReader()
        }

        private fun clientAuthorized(s: SSLSocket): Boolean {
            val chain = try {
                s.session.peerCertificates.filterIsInstance<X509Certificate>().toTypedArray()
            } catch (_: IOException) {
                return false
            }
            if (chain.isEmpty()) return false
            return try {
                verifier?.base?.checkClientTrusted(chain, chain[0].publicKey.algorithm)
                true
            } catch (_: Exception) {
                false
            }
        }

        fun close() {
            if (closed.compareAndSet(false, true)) closeQuietly(ss)
        }
    }

    // ── Connections ─────────────────────────────────────────────────────────

    private inner class Conn(val id: String, val socket: Socket) {
        private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "MeshNet-tcp-write").apply { isDaemon = true } }
        private val closed = AtomicBoolean(false)
        private val output = socket.getOutputStream()

        @Volatile
        private var readEof = false

        @Volatile
        private var writeShut = false

        @Volatile
        private var closingLocally = false

        fun startReader() {
            try {
                threads.execute { readLoop() }
            } catch (_: RejectedExecutionException) {
                finish(null)
            }
        }

        private fun readLoop() {
            val buf = ByteArray(READ_BUFFER)
            try {
                val input = socket.getInputStream()
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) {
                        sink.emit("tcpEnd", mapOf("id" to id))
                        readEof = true
                        if (writeShut) finish(null)
                        return
                    }
                    if (n > 0) sink.emit("tcpData", mapOf("id" to id, "dataB64" to Codec.b64(buf, 0, n)))
                }
            } catch (e: IOException) {
                if (closed.get() || closingLocally) return
                finish(NetErrors.describe(e, "read", null))
            }
        }

        fun write(bytes: ByteArray, done: (Throwable?) -> Unit) {
            try {
                writer.execute {
                    if (closed.get() || writeShut) {
                        done(PluginError("EPIPE write EPIPE (socket closed)"))
                        return@execute
                    }
                    try {
                        output.write(bytes)
                        output.flush()
                        done(null)
                    } catch (e: IOException) {
                        val msg = NetErrors.describe(e, "write", null)
                        done(PluginError(msg, e))
                        if (!closingLocally) finish(msg)
                    }
                }
            } catch (_: RejectedExecutionException) {
                done(PluginError("EPIPE write EPIPE (socket closed)"))
            }
        }

        fun end(done: (Throwable?) -> Unit) {
            try {
                writer.execute {
                    if (!closed.get() && !writeShut) {
                        writeShut = true
                        try {
                            output.flush()
                            socket.shutdownOutput()
                        } catch (_: Exception) {
                            // SSLSocket (Conscrypt) cannot half-close; close the whole socket.
                            closingLocally = true
                            finish(null)
                        }
                        if (readEof) finish(null)
                    }
                    done(null)
                }
            } catch (_: RejectedExecutionException) {
                done(null)
            }
        }

        fun destroy() {
            closingLocally = true
            finish(null)
        }

        fun finish(error: String?) {
            if (!closed.compareAndSet(false, true)) return
            conns.remove(id, this)
            closeQuietly(socket)
            writer.shutdown()
            sink.emit("tcpClose", mapOf("id" to id, "error" to error))
        }
    }

    companion object {
        private const val READ_BUFFER = 64 * 1024

        fun addressInfo(s: Socket): Map<String, Any?> = mapOf(
            "localAddress" to s.localAddress?.hostAddress,
            "localPort" to s.localPort,
            "remoteAddress" to s.inetAddress?.hostAddress,
            "remotePort" to s.port,
            "remoteFamily" to s.inetAddress?.let { IpLiteral.family(it) },
        )

        fun closeQuietly(c: java.io.Closeable?) {
            try {
                c?.close()
            } catch (_: Exception) {
                // already closed
            }
        }
    }
}
