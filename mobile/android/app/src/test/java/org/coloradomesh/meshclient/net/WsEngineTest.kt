package org.coloradomesh.meshclient.net

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.RecordingSink
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class WsEngineTest {
    private val sink = RecordingSink()
    private val ws = WsEngine(sink)
    private val server = MockWebServer()

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() {
        ws.shutdown()
        server.close()
    }

    /** Server side: echoes, closes with 4001 on "close-me". */
    private val echo = object : WebSocketListener() {
        override fun onOpen(webSocket: WebSocket, response: Response) {
            webSocket.send("hello")
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (text == "close-me") webSocket.close(4001, "bye") else webSocket.send(text)
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            webSocket.send(bytes)
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(code, reason)
        }
    }

    private fun wsUrl() = server.url("/ws").toString().replace("http:", "ws:")

    @Test
    fun opensWithHeadersAndProtocolAndExchangesMessages() {
        server.enqueue(MockResponse.Builder().addHeader("Sec-WebSocket-Protocol", "mesh.v1").webSocketUpgrade(echo).build())
        ws.connect(WsOptions("w", wsUrl(), mapOf("Authorization" to "Bearer tok"), listOf("mesh.v1"), 5_000, true))
        sink.await(what = "open") { sink.of("wsOpen", "w").isNotEmpty() }
        assertEquals("mesh.v1", sink.of("wsOpen", "w").single()["protocol"])
        val req = server.takeRequest()
        assertEquals("Bearer tok", req.headers["Authorization"])
        assertEquals("mesh.v1", req.headers["Sec-WebSocket-Protocol"])
        ws.send("w", "text-msg", null)
        ws.send("w", null, byteArrayOf(1, 2, 3))
        sink.await(what = "echoes") { sink.of("wsMessage", "w").size >= 3 }
        val msgs = sink.of("wsMessage", "w")
        assertEquals("hello", msgs[0]["text"])
        assertEquals("text-msg", msgs[1]["text"])
        assertEquals(listOf<Byte>(1, 2, 3), Codec.unb64(msgs[2]["dataB64"] as String).toList())
        ws.send("w", "close-me", null)
        sink.await(what = "close") { sink.of("wsClose", "w").isNotEmpty() }
        assertEquals(mapOf("id" to "w", "code" to 4001, "reason" to "bye"), sink.of("wsClose", "w").single())
    }

    @Test
    fun terminateWithReservedCodeClosesWith1006Once() {
        server.enqueue(MockResponse.Builder().webSocketUpgrade(echo).build())
        ws.connect(WsOptions("t", wsUrl(), emptyMap(), emptyList(), null, true))
        sink.await { sink.of("wsOpen", "t").isNotEmpty() }
        ws.close("t", 1006, "terminate")
        sink.await { sink.of("wsClose", "t").isNotEmpty() }
        Thread.sleep(200)
        assertEquals(1, sink.of("wsClose", "t").size)
        assertEquals(1006, sink.of("wsClose", "t").single()["code"])
        assertTrue(sink.of("wsError", "t").isEmpty())
    }

    @Test
    fun failedConnectionsEmitErrorThenClose() {
        val port = server.port
        server.close()
        ws.connect(WsOptions("f", "ws://127.0.0.1:$port/", emptyMap(), emptyList(), 2_000, true))
        sink.await(what = "error+close") { sink.of("wsClose", "f").isNotEmpty() }
        assertTrue((sink.of("wsError", "f").single()["message"] as String).startsWith("ECONNREFUSED"))
        assertEquals(1006, sink.of("wsClose", "f").single()["code"])
        val order = sink.events.filter { it.second["id"] == "f" }.map { it.first }
        assertEquals(listOf("wsError", "wsClose"), order)
    }

    @Test
    fun closeCodesFollowRfc6455() {
        assertTrue(WsEngine.validCloseCode(1000))
        assertTrue(WsEngine.validCloseCode(4001))
        assertFalse(WsEngine.validCloseCode(1006))
        assertFalse(WsEngine.validCloseCode(1005))
        assertFalse(WsEngine.validCloseCode(1015))
        assertFalse(WsEngine.validCloseCode(999))
        assertFalse(WsEngine.validCloseCode(5000))
        assertTrue(WsEngine.truncateReason("é".repeat(100)).toByteArray().size <= 123)
        assertTrue(WsEngine.truncateReason("x".repeat(200)).length == 123)
    }
}
