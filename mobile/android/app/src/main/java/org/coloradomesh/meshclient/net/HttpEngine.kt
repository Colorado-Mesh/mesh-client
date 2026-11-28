package org.coloradomesh.meshclient.net

import okhttp3.Call
import okhttp3.Callback
import okhttp3.Dispatcher
import okhttp3.Dns
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.EventSink
import java.io.IOException
import java.net.InetAddress
import java.net.Proxy
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class HttpOptions(
    val id: String,
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val body: ByteArray? = null,
    val followRedirects: Boolean = true,
)

/** Connects [host] to an address the host worker already validated (`x-mesh-pinned-address`). */
class PinnedDns(private val host: String, private val address: InetAddress) : Dns {
    override fun lookup(hostname: String): List<InetAddress> =
        if (hostname.equals(host, ignoreCase = true)) listOf(address) else Dns.SYSTEM.lookup(hostname)
}

/**
 * MeshNet streaming HTTP(S) client on OkHttp (the host worker's `fetch`). `httpRequest` resolves
 * with status + headers; the body then streams as `httpData` chunks and ends with `httpEnd` or
 * `httpError`. Bodies are read on our own threads so long-lived streams do not hold OkHttp
 * dispatcher slots. Gzip is transparent (the caller's `accept-encoding` is dropped), matching the
 * decoded body Node `fetch` returns. Timeouts mirror undici: 300 s for headers and between body
 * chunks; callers abort earlier with `httpCancel`.
 */
class HttpEngine(private val sink: EventSink, private val base: OkHttpClient = defaultClient()) {
    private val calls = ConcurrentHashMap<String, Call>()
    private val bodyThreads: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "MeshNet-http-body").apply { isDaemon = true } }

    fun request(o: HttpOptions, onStart: (Map<String, Any?>) -> Unit, onFail: (String) -> Unit) {
        val url = o.url.toHttpUrlOrNull()
        if (url == null) {
            onFail("ERR_INVALID_URL Invalid URL: ${o.url}")
            return
        }
        var pinned: InetAddress? = null
        val headers = Headers.Builder()
        for ((name, value) in o.headers) {
            when (val lower = name.lowercase(Locale.ROOT)) {
                PINNED_HEADER -> {
                    pinned = IpLiteral.parse(value.trim())
                    if (pinned == null) {
                        onFail("EINVAL invalid $PINNED_HEADER")
                        return
                    }
                }
                "accept-encoding" -> if (value.trim().equals("identity", ignoreCase = true)) headers.addUnsafeNonAscii(name, value)
                in HOP_BY_HOP -> Unit
                else -> if (lower.isNotEmpty()) headers.addUnsafeNonAscii(name, value)
            }
        }
        val method = o.method.uppercase(Locale.ROOT).ifEmpty { "GET" }
        val body: RequestBody? = when {
            o.body != null && o.body.isNotEmpty() -> o.body.toRequestBody(null)
            method in BODY_REQUIRED -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        val request = try {
            Request.Builder().url(url).headers(headers.build()).method(method, body).build()
        } catch (e: IllegalArgumentException) {
            onFail("ERR_INVALID_ARG_VALUE ${e.message}")
            return
        }
        val client = base.newBuilder()
            .followRedirects(o.followRedirects)
            .followSslRedirects(o.followRedirects)
            .apply { pinned?.let { dns(PinnedDns(url.host, it)) } }
            .build()
        val call = client.newCall(request)
        calls.put(o.id, call)?.cancel()
        val target = NetErrors.target(url.host, url.port)
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                calls.remove(o.id, call)
                onFail(if (call.isCanceled()) "ABORT_ERR The operation was aborted" else NetErrors.describe(e, "connect", target))
            }

            override fun onResponse(call: Call, response: Response) {
                if (call.isCanceled()) {
                    response.close()
                    calls.remove(o.id, call)
                    onFail("ABORT_ERR The operation was aborted")
                    return
                }
                val out = LinkedHashMap<String, String>()
                for (i in 0 until response.headers.size) {
                    val k = response.headers.name(i).lowercase(Locale.ROOT)
                    val v = response.headers.value(i)
                    out[k] = out[k]?.let { "$it, $v" } ?: v
                }
                onStart(
                    mapOf(
                        "status" to response.code,
                        "statusText" to response.message,
                        "headers" to out,
                        "url" to response.request.url.toString(),
                    ),
                )
                try {
                    bodyThreads.execute { stream(o.id, call, response) }
                } catch (e: Exception) {
                    response.close()
                    calls.remove(o.id, call)
                    sink.emit("httpError", mapOf("id" to o.id, "message" to "ECONNRESET ${e.javaClass.simpleName}"))
                }
            }
        })
    }

    private fun stream(id: String, call: Call, response: Response) {
        try {
            val input = response.body.byteStream()
            val buf = ByteArray(CHUNK)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                if (n > 0 && !call.isCanceled()) sink.emit("httpData", mapOf("id" to id, "dataB64" to Codec.b64(buf, 0, n)))
            }
            if (!call.isCanceled()) sink.emit("httpEnd", mapOf("id" to id))
        } catch (e: IOException) {
            if (!call.isCanceled()) sink.emit("httpError", mapOf("id" to id, "message" to NetErrors.describe(e, "read", null)))
        } finally {
            response.close()
            calls.remove(id, call)
        }
    }

    fun cancel(id: String) {
        calls.remove(id)?.cancel()
    }

    fun shutdown() {
        calls.values.forEach { it.cancel() }
        calls.clear()
        bodyThreads.shutdownNow()
    }

    companion object {
        const val PINNED_HEADER = "x-mesh-pinned-address"
        private const val CHUNK = 64 * 1024
        private val HOP_BY_HOP = setOf("content-length", "connection", "keep-alive", "transfer-encoding", "host", "upgrade", "te", "trailer", "proxy-connection")
        private val BODY_REQUIRED = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")

        /**
         * Shared client: direct connections (Node ignores system proxies; LAN radios must not go
         * through one), certificate failures reported with Node codes, generous dispatcher limits
         * for concurrent long-lived streams (sidecar, tiles).
         */
        fun defaultClient(): OkHttpClient {
            val trust = RecordingTrustManager(TlsSupport.baseTrustManager(emptyList()), reject = true)
            val ctx = TlsSupport.context(null, trust)
            return OkHttpClient.Builder()
                .proxy(Proxy.NO_PROXY)
                .sslSocketFactory(ctx.socketFactory, trust)
                .connectTimeout(20, TimeUnit.SECONDS)
                .readTimeout(300, TimeUnit.SECONDS)
                .writeTimeout(300, TimeUnit.SECONDS)
                .dispatcher(Dispatcher().apply { maxRequests = 256; maxRequestsPerHost = 64 })
                .build()
        }
    }
}
