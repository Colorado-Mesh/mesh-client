package org.coloradomesh.meshclient.net

import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.PluginError
import org.coloradomesh.meshclient.bridge.RecordingSink
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.Date
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLServerSocket
import kotlin.concurrent.thread

class TcpEngineTest {
    private val sink = RecordingSink()
    private val tcp = TcpEngine(sink)
    private val servers = mutableListOf<ServerSocket>()

    @After
    fun tearDown() {
        tcp.shutdown()
        servers.forEach { it.close() }
    }

    private fun server(handle: (Socket) -> Unit): Int {
        val ss = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
        servers += ss
        thread(isDaemon = true) {
            while (!ss.isClosed) {
                val s = try { ss.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { try { handle(s) } catch (_: Exception) { } }
            }
        }
        return ss.localPort
    }

    private fun echoServer() = server { s -> s.getInputStream().copyTo(s.getOutputStream()); s.shutdownOutput() }

    private fun connect(id: String, port: Int, tls: Boolean = false, reject: Boolean = true, ca: List<ByteArray> = emptyList(), servername: String? = null): Map<String, Any?> {
        var info: Map<String, Any?>? = null
        tcp.connect(TcpConnectOptions(id = id, host = "127.0.0.1", port = port, tls = tls, rejectUnauthorized = reject, material = TlsMaterial(ca = ca), servername = servername ?: "127.0.0.1", timeoutMs = 5_000)) { info = it }
        return info!!
    }

    private fun write(id: String, s: String) {
        val latch = CountDownLatch(1)
        var err: Throwable? = null
        tcp.write(id, s.toByteArray()) { e -> err = e; latch.countDown() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        err?.let { throw it }
    }

    private fun end(id: String) {
        val latch = CountDownLatch(1)
        tcp.end(id) { latch.countDown() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
    }

    @Test
    fun connectsAndEchoesWritesInOrder() {
        val info = connect("a", echoServer())
        assertEquals("127.0.0.1", info["remoteAddress"])
        assertEquals("IPv4", info["remoteFamily"])
        val latch = CountDownLatch(100)
        repeat(100) { i -> tcp.write("a", "m$i;".toByteArray()) { latch.countDown() } }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        val expected = (0 until 100).joinToString("") { "m$it;" }
        sink.await(what = "echo") { sink.text("tcpData", "a") == expected }
    }

    @Test
    fun halfCloseThenPeerFinClosesOnceWithoutError() {
        connect("b", echoServer())
        write("b", "bye")
        end("b")
        sink.await(what = "close") { sink.of("tcpClose", "b").isNotEmpty() }
        assertEquals("bye", sink.text("tcpData", "b"))
        assertEquals(1, sink.of("tcpEnd", "b").size)
        Thread.sleep(100)
        assertEquals(listOf(mapOf("id" to "b", "error" to null)), sink.of("tcpClose", "b"))
        // Writes after close fail with EPIPE like Node.
        val e = assertThrows(PluginError::class.java) { write("b", "late") }
        assertTrue(e.message!!.startsWith("EPIPE"))
    }

    @Test
    fun peerFinIsReportedAsTcpEnd() {
        val port = server { s -> s.getOutputStream().write("hello".toByteArray()); s.shutdownOutput(); Thread.sleep(2_000) }
        connect("c", port)
        sink.await(what = "tcpEnd") { sink.of("tcpEnd", "c").isNotEmpty() }
        assertEquals("hello", sink.text("tcpData", "c"))
        assertTrue(sink.of("tcpClose", "c").isEmpty()) // still writable until we end
        end("c")
        sink.await(what = "close") { sink.of("tcpClose", "c").size == 1 }
    }

    @Test
    fun peerResetClosesWithEconnreset() {
        val port = server { s -> s.setSoLinger(true, 0); Thread.sleep(100); s.close() }
        connect("d", port)
        sink.await(what = "reset close") { sink.of("tcpClose", "d").isNotEmpty() }
        val err = sink.of("tcpClose", "d").single()["error"] as String?
        // Linux may report the RST as a reset or (rarely) as EOF first.
        assertTrue("got $err", err == null || err.startsWith("ECONNRESET"))
    }

    @Test
    fun destroyEmitsASingleCloseWithoutError() {
        connect("e", echoServer())
        tcp.destroy("e")
        tcp.destroy("e")
        sink.await { sink.of("tcpClose", "e").isNotEmpty() }
        Thread.sleep(100)
        assertEquals(1, sink.of("tcpClose", "e").size)
        assertNull(sink.of("tcpClose", "e").single()["error"])
    }

    @Test
    fun refusedConnectionsRejectWithEconnrefused() {
        val port = ServerSocket(0).use { it.localPort }
        val e = assertThrows(PluginError::class.java) { connect("f", port) }
        assertEquals("ECONNREFUSED connect ECONNREFUSED 127.0.0.1:$port", e.message)
        assertTrue(sink.of("tcpClose", "f").isEmpty())
    }

    @Test
    fun unknownHostsRejectWithEnotfound() {
        val e = assertThrows(PluginError::class.java) {
            tcp.connect(TcpConnectOptions(id = "g", host = "no-such-host.invalid", port = 1)) {}
        }
        assertEquals("ENOTFOUND getaddrinfo ENOTFOUND no-such-host.invalid", e.message)
    }

    @Test
    fun unknownIdsAreNoOpsExceptWrite() {
        tcp.destroy("nope")
        tcp.setOptions("nope", true, true)
        end("nope")
        val e = assertThrows(PluginError::class.java) { write("nope", "x") }
        assertTrue(e.message!!.startsWith("EPIPE"))
    }

    @Test
    fun listensAndAcceptsConnections() {
        val r = tcp.listen(TcpListenOptions("L", "127.0.0.1", 0))
        val port = r["port"] as Int
        Socket("127.0.0.1", port).use { client ->
            sink.await(what = "accept") { sink.of("tcpAccept").isNotEmpty() }
            val acc = sink.of("tcpAccept").single()
            assertEquals("L", acc["serverId"])
            val id = acc["id"] as String
            write(id, "from-server")
            val buf = ByteArray(11)
            client.getInputStream().read(buf)
            assertEquals("from-server", String(buf))
            client.getOutputStream().write("from-client".toByteArray())
            sink.await(what = "server data") { sink.text("tcpData", id) == "from-client" }
        }
        tcp.serverClose("L")
        assertThrows(Exception::class.java) { Socket("127.0.0.1", port).close() }
    }

    @Test
    fun listenOnABusyPortRejectsWithEaddrinuse() {
        val busy = ServerSocket(0, 50, InetAddress.getByName("127.0.0.1")).also { servers += it }
        val e = assertThrows(PluginError::class.java) { tcp.listen(TcpListenOptions("L2", "127.0.0.1", busy.localPort)) }
        assertTrue(e.message, e.message!!.startsWith("EADDRINUSE listen EADDRINUSE"))
    }

    // ── TLS ─────────────────────────────────────────────────────────────────

    private fun tlsEchoServer(cert: TestCerts.Cert): Int {
        val ss = cert.serverContext().serverSocketFactory.createServerSocket(0, 50, InetAddress.getLoopbackAddress()) as SSLServerSocket
        servers += ss
        thread(isDaemon = true) {
            while (!ss.isClosed) {
                val s = try { ss.accept() } catch (_: Exception) { break }
                thread(isDaemon = true) { try { s.getInputStream().copyTo(s.getOutputStream()) } catch (_: Exception) { } }
            }
        }
        return ss.localPort
    }

    @Test
    fun selfSignedServersAreRejectedWithNodeCodes() {
        val port = tlsEchoServer(TestCerts.selfSigned())
        val e = assertThrows(PluginError::class.java) { connect("t1", port, tls = true) }
        assertEquals("DEPTH_ZERO_SELF_SIGNED_CERT self-signed certificate", e.message)
    }

    @Test
    fun rejectUnauthorizedFalseConnectsButReportsTheFailure() {
        val port = tlsEchoServer(TestCerts.selfSigned())
        val info = connect("t2", port, tls = true, reject = false)
        assertEquals(false, info["authorized"])
        assertEquals("DEPTH_ZERO_SELF_SIGNED_CERT", info["authorizationError"])
        write("t2", "secure")
        sink.await(what = "tls echo") { sink.text("tcpData", "t2") == "secure" }
    }

    @Test
    fun customCaIsTrustedAndHostnamesAreVerified() {
        val cert = TestCerts.selfSigned(dns = listOf("localhost"), ips = listOf(byteArrayOf(127, 0, 0, 1)))
        val port = tlsEchoServer(cert)
        val ca = listOf(cert.certPem.toByteArray())
        val info = connect("t3", port, tls = true, ca = ca)
        assertEquals(true, info["authorized"])
        assertNull(info["authorizationError"])
        val e = assertThrows(PluginError::class.java) { connect("t4", port, tls = true, ca = ca, servername = "other.example") }
        assertTrue(e.message, e.message!!.startsWith("ERR_TLS_CERT_ALTNAME_INVALID"))
        val insecure = connect("t5", port, tls = true, ca = ca, reject = false, servername = "other.example")
        assertEquals(false, insecure["authorized"])
        assertEquals("ERR_TLS_CERT_ALTNAME_INVALID", insecure["authorizationError"])
    }

    @Test
    fun expiredCertificatesReportCertHasExpired() {
        val day = 86_400_000L
        val cert = TestCerts.selfSigned(notBefore = Date(System.currentTimeMillis() - 400 * day), notAfter = Date(System.currentTimeMillis() - 10 * day))
        val port = tlsEchoServer(cert)
        val e = assertThrows(PluginError::class.java) { connect("t6", port, tls = true, ca = listOf(cert.certPem.toByteArray())) }
        assertEquals("CERT_HAS_EXPIRED certificate has expired", e.message)
    }

    @Test
    fun tlsServersTerminateTlsNatively() {
        val cert = TestCerts.selfSigned()
        val material = TlsMaterial(cert = cert.certPem.toByteArray(), key = cert.keyPkcs8Pem.toByteArray())
        val port = tcp.listen(TcpListenOptions("TL", "127.0.0.1", 0, TcpServerTls(material, requestCert = false, rejectUnauthorized = false)))["port"] as Int
        val info = connect("tc", port, tls = true, ca = listOf(cert.certPem.toByteArray()))
        assertEquals(true, info["authorized"])
        sink.await(what = "tls accept") { sink.of("tcpAccept").isNotEmpty() }
        val acc = sink.of("tcpAccept").single()
        assertEquals(false, acc["authorized"]) // no client certificate requested
        write("tc", "hi")
        sink.await(what = "server got data") { sink.text("tcpData", acc["id"] as String) == "hi" }
        assertEquals("", Codec.b64(ByteArray(0)))
    }
}
