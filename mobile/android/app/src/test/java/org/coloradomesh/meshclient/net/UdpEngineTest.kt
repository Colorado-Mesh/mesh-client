package org.coloradomesh.meshclient.net

import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.PluginError
import org.coloradomesh.meshclient.bridge.RecordingSink
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class UdpEngineTest {
    private val sink = RecordingSink()
    private val lockStates = CopyOnWriteArrayList<Boolean>()
    private val udp = UdpEngine(sink) { lockStates += it }

    @After
    fun tearDown() = udp.shutdown()

    @Test
    fun sendsAndReceivesBetweenSockets() {
        udp.create("a", "udp4", reuseAddr = false)
        udp.create("b", "udp4", reuseAddr = false)
        val a = udp.bind("a", 0, "127.0.0.1")
        udp.bind("b", 0, "127.0.0.1")
        assertEquals("127.0.0.1", a["address"])
        udp.send("b", "ping".toByteArray(), a["port"] as Int, "127.0.0.1")
        sink.await(what = "datagram") { sink.of("udpMessage", "a").isNotEmpty() }
        val m = sink.of("udpMessage", "a").single()
        assertEquals("ping", String(Codec.unb64(m["dataB64"] as String)))
        assertEquals("127.0.0.1", m["address"])
    }

    @Test
    fun sendBeforeBindBindsImplicitlyAndReceivesReplies() {
        udp.create("srv", "udp4", false)
        val port = udp.bind("srv", 0, "127.0.0.1")["port"] as Int
        udp.create("cli", "udp4", false)
        udp.send("cli", "hi".toByteArray(), port, "127.0.0.1")
        sink.await { sink.of("udpMessage", "srv").isNotEmpty() }
        val from = sink.of("udpMessage", "srv").single()["port"] as Int
        udp.send("srv", "reply".toByteArray(), from, "127.0.0.1")
        sink.await(what = "reply on implicitly bound socket") { sink.of("udpMessage", "cli").isNotEmpty() }
    }

    /** Regression: on Android DatagramSocket.setBroadcast blocked while receive() was waiting. */
    @Test
    fun optionsCanChangeWhileTheReceiveLoopIsBlocked() {
        udp.create("o", "udp4", reuseAddr = true)
        udp.bind("o", 0, "0.0.0.0")
        Thread.sleep(100) // receive loop is now blocked in receive()
        val f = Executors.newSingleThreadExecutor().submit { udp.setOptions("o", broadcast = true, multicastTtl = 4, multicastLoopback = true) }
        f.get(2, TimeUnit.SECONDS)
        assertEquals(listOf(true), lockStates)
        udp.setOptions("o", broadcast = false, multicastTtl = null, multicastLoopback = null)
        assertEquals(listOf(true, false), lockStates)
    }

    @Test
    fun closingReleasesTheMulticastLock() {
        udp.create("m", "udp4", reuseAddr = true)
        udp.setOptions("m", broadcast = true, multicastTtl = null, multicastLoopback = null)
        udp.close("m")
        assertEquals(listOf(true, false), lockStates)
    }

    @Test
    fun unknownSocketsAndDoubleBindsFailLikeNode() {
        assertTrue(assertThrows(PluginError::class.java) { udp.send("nope", ByteArray(1), 1, "127.0.0.1") }.message!!.startsWith("ERR_SOCKET_DGRAM_NOT_RUNNING"))
        udp.create("d", "udp4", false)
        udp.bind("d", 0, "127.0.0.1")
        assertTrue(assertThrows(PluginError::class.java) { udp.bind("d", 0, "127.0.0.1") }.message!!.startsWith("ERR_SOCKET_ALREADY_BOUND"))
        udp.close("d")
        udp.close("d")
    }
}
