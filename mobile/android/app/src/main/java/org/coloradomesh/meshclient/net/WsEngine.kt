package org.coloradomesh.meshclient.net

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.EventSink
import org.coloradomesh.meshclient.bridge.PluginError
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

data class WsOptions(
    val id: String,
    val url: String,
    val headers: Map<String, String>,
    val protocols: List<String>,
    val timeoutMs: Int?,
    val rejectUnauthorized: Boolean,
)

/**
 * MeshNet WebSocket client on OkHttp (`ws` package shim: custom headers such as the Reticulum
 * sidecar bearer token). Events: `wsOpen`, `wsMessage` (text or base64 binary), `wsClose`
 * (exactly once), `wsError` (followed by `wsClose` 1006, like the `ws` package).
 */
class WsEngine(private val sink: EventSink, private val base: OkHttpClient = HttpEngine.defaultClient()) {
    private val sockets = ConcurrentHashMap<String, Ws>()
    private val timers = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "MeshNet-ws-timer").apply { isDaemon = true } }

    fun connect(o: WsOptions) {
        val request = try {
            Request.Builder().url(o.url).apply {
                for ((k, v) in o.headers) {
                    if (k.lowercase(Locale.ROOT) in SKIP_HEADERS) continue
                    addHeader(k, v)
                }
                if (o.protocols.isNotEmpty()) header("Sec-WebSocket-Protocol", o.protocols.joinToString(", "))
            }.build()
        } catch (e: IllegalArgumentException) {
            throw PluginError("ERR_INVALID_URL Invalid URL: ${o.url}", e)
        }
        val timeout = (o.timeoutMs ?: 0).takeIf { it > 0 }?.toLong()
        val client = base.newBuilder()
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .apply {
                if (timeout != null) connectTimeout(timeout, TimeUnit.MILLISECONDS)
                if (!o.rejectUnauthorized) {
                    sslSocketFactory(TlsSupport.context(null, TrustAllManager).socketFactory, TrustAllManager)
                    hostnameVerifier { _, _ -> true }
                }
            }
            .build()
        val ws = Ws(o.id)
        sockets.put(o.id, ws)?.cancel()
        ws.socket = client.newWebSocket(request, ws)
        if (timeout != null) {
            ws.handshakeTimer = timers.schedule({
                if (!ws.opened.get()) ws.fail("ETIMEDOUT Opening handshake has timed out")
            }, timeout, TimeUnit.MILLISECONDS)
        }
    }

    fun send(id: String, text: String?, data: ByteArray?) {
        val ws = sockets[id] ?: throw PluginError("WebSocket is not open: readyState 3 (CLOSED)")
        val s = ws.socket ?: throw PluginError("WebSocket is not open: readyState 0 (CONNECTING)")
        val ok = if (text != null) s.send(text) else s.send((data ?: ByteArray(0)).toByteString())
        if (!ok) throw PluginError("WebSocket is not open: readyState 2 (CLOSING)")
    }

    fun close(id: String, code: Int, reason: String) {
        val ws = sockets[id] ?: return
        ws.closingLocally = true
        val s = ws.socket ?: return
        if (validCloseCode(code)) {
            try {
                if (s.close(code, truncateReason(reason))) return
            } catch (_: IllegalArgumentException) {
                // fall through to cancel
            }
        }
        // 1006 (terminate) and other reserved codes cannot be sent; drop the connection.
        s.cancel()
        ws.closed(1006, reason)
    }

    fun shutdown() {
        sockets.values.forEach { it.cancel() }
        sockets.clear()
        timers.shutdownNow()
    }

    private inner class Ws(val id: String) : WebSocketListener() {
        @Volatile
        var socket: WebSocket? = null

        @Volatile
        var handshakeTimer: ScheduledFuture<*>? = null

        @Volatile
        var closingLocally = false
        val opened = AtomicBoolean(false)
        private val done = AtomicBoolean(false)

        override fun onOpen(webSocket: WebSocket, response: Response) {
            opened.set(true)
            handshakeTimer?.cancel(false)
            sink.emit("wsOpen", mapOf("id" to id, "protocol" to (response.header("Sec-WebSocket-Protocol") ?: "")))
        }

        override fun onMessage(webSocket: WebSocket, text: String) {
            if (!done.get()) sink.emit("wsMessage", mapOf("id" to id, "text" to text))
        }

        override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
            if (!done.get()) sink.emit("wsMessage", mapOf("id" to id, "dataB64" to Codec.b64(bytes.toByteArray())))
        }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            // Complete the closing handshake the peer started.
            try {
                webSocket.close(if (validCloseCode(code)) code else 1000, null)
            } catch (_: IllegalArgumentException) {
                webSocket.cancel()
            }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = closed(code, reason)

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
            if (closingLocally) {
                closed(1006, "")
                return
            }
            val msg = if (response != null && !opened.get()) {
                "Unexpected server response: ${response.code}"
            } else {
                val url = webSocket.request().url
                NetErrors.describe(t, "connect", NetErrors.target(url.host, url.port))
            }
            fail(msg)
        }

        fun fail(message: String) {
            if (done.get()) return
            sink.emit("wsError", mapOf("id" to id, "message" to message))
            socket?.cancel()
            closed(1006, "")
        }

        fun closed(code: Int, reason: String) {
            if (!done.compareAndSet(false, true)) return
            handshakeTimer?.cancel(false)
            sockets.remove(id, this)
            sink.emit("wsClose", mapOf("id" to id, "code" to code, "reason" to reason))
        }

        fun cancel() {
            closingLocally = true
            socket?.cancel()
            closed(1006, "")
        }
    }

    companion object {
        private val SKIP_HEADERS = setOf("sec-websocket-key", "sec-websocket-version", "sec-websocket-extensions", "connection", "upgrade", "host", "content-length")

        /** RFC 6455 codes an endpoint may send (OkHttp rejects 1004-1006 and 1015-2999). */
        fun validCloseCode(code: Int): Boolean = code in 1000..1003 || code in 1007..1014 || code in 3000..4999

        /** Close reasons are limited to 123 UTF-8 bytes. */
        fun truncateReason(reason: String): String {
            var r = reason
            while (r.toByteArray(Charsets.UTF_8).size > 123) r = r.dropLast(1)
            return r
        }
    }
}
