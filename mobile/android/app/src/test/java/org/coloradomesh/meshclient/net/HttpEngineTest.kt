package org.coloradomesh.meshclient.net

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import okio.Buffer
import org.coloradomesh.meshclient.bridge.RecordingSink
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit
import java.util.zip.GZIPOutputStream

class HttpEngineTest {
    private val sink = RecordingSink()
    private val http = HttpEngine(sink)
    private val server = MockWebServer()

    @Before
    fun setUp() = server.start()

    @After
    fun tearDown() {
        http.shutdown()
        server.close()
    }

    private fun request(o: HttpOptions): Result<Map<String, Any?>> {
        val f = CompletableFuture<Result<Map<String, Any?>>>()
        http.request(o, onStart = { f.complete(Result.success(it)) }, onFail = { f.complete(Result.failure(IllegalStateException(it))) })
        return f.get(10, TimeUnit.SECONDS)
    }

    private fun url(path: String) = server.url(path).toString()

    @Test
    fun resolvesWithStatusAndHeadersThenStreamsTheBody() {
        server.enqueue(MockResponse.Builder().code(201).addHeader("X-Multi", "a").addHeader("X-Multi", "b").chunkedBody("hello streaming world", 5).build())
        val start = request(HttpOptions("h1", url("/s"), "GET", emptyMap())).getOrThrow()
        assertEquals(201, start["status"])
        @Suppress("UNCHECKED_CAST")
        val headers = start["headers"] as Map<String, String>
        assertEquals("a, b", headers["x-multi"])
        assertTrue(headers.keys.all { it == it.lowercase() })
        sink.await(what = "httpEnd") { sink.of("httpEnd", "h1").isNotEmpty() }
        assertEquals("hello streaming world", sink.text("httpData", "h1"))
        assertTrue(sink.of("httpError", "h1").isEmpty())
    }

    @Test
    fun decodesGzipTransparentlyAndDropsTheCallersAcceptEncoding() {
        val gz = Buffer().also { b -> GZIPOutputStream(b.outputStream()).use { it.write("decoded".toByteArray()) } }
        server.enqueue(MockResponse.Builder().addHeader("Content-Encoding", "gzip").body(gz).build())
        val start = request(HttpOptions("g", url("/gz"), "GET", mapOf("Accept-Encoding" to "gzip, br"))).getOrThrow()
        @Suppress("UNCHECKED_CAST")
        assertNull((start["headers"] as Map<String, String>)["content-encoding"])
        sink.await { sink.of("httpEnd", "g").isNotEmpty() }
        assertEquals("decoded", sink.text("httpData", "g"))
        assertEquals("gzip", server.takeRequest().headers["Accept-Encoding"])
    }

    @Test
    fun sendsBodiesAndHeaders() {
        server.enqueue(MockResponse.Builder().code(204).build())
        request(HttpOptions("p", url("/post"), "POST", mapOf("Content-Type" to "application/json", "Authorization" to "Bearer t", "Content-Length" to "999"), body = "{\"a\":1}".toByteArray())).getOrThrow()
        val r = server.takeRequest()
        assertEquals("POST", r.method)
        assertEquals("{\"a\":1}", r.body!!.utf8())
        assertEquals("application/json", r.headers["Content-Type"])
        assertEquals("Bearer t", r.headers["Authorization"])
        assertEquals("7", r.headers["Content-Length"])
    }

    @Test
    fun postWithoutABodySendsAnEmptyOne() {
        server.enqueue(MockResponse.Builder().build())
        request(HttpOptions("e", url("/"), "post", emptyMap())).getOrThrow()
        assertEquals("POST", server.takeRequest().method)
    }

    @Test
    fun pinnedAddressConnectsThereKeepsHostAndStripsTheHeader() {
        server.enqueue(MockResponse.Builder().body("ok").build())
        val pinnedUrl = "http://pinned.invalid:${server.port}/x"
        val start = request(HttpOptions("pin", pinnedUrl, "GET", mapOf("x-mesh-pinned-address" to "127.0.0.1"))).getOrThrow()
        assertEquals(200, start["status"])
        assertEquals(pinnedUrl, start["url"])
        val r = server.takeRequest()
        assertEquals("pinned.invalid:${server.port}", r.headers["Host"])
        assertNull(r.headers["x-mesh-pinned-address"])
    }

    @Test
    fun invalidPinnedAddressesAreRejected() {
        val r = request(HttpOptions("bad", url("/"), "GET", mapOf("x-mesh-pinned-address" to "evil.example")))
        assertEquals("EINVAL invalid x-mesh-pinned-address", r.exceptionOrNull()!!.message)
        assertEquals(0, server.requestCount)
    }

    @Test
    fun redirectsFollowUnlessDisabled() {
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "/final").build())
        server.enqueue(MockResponse.Builder().body("done").build())
        val followed = request(HttpOptions("r1", url("/start"), "GET", emptyMap())).getOrThrow()
        assertEquals(200, followed["status"])
        assertEquals(url("/final"), followed["url"])
        server.enqueue(MockResponse.Builder().code(302).addHeader("Location", "/final").build())
        val manual = request(HttpOptions("r2", url("/start"), "GET", emptyMap(), followRedirects = false)).getOrThrow()
        assertEquals(302, manual["status"])
    }

    @Test
    fun cancelStopsTheStreamWithoutFurtherEvents() {
        server.enqueue(MockResponse.Builder().body("x".repeat(100_000)).throttleBody(1_000, 200, TimeUnit.MILLISECONDS).build())
        request(HttpOptions("c", url("/slow"), "GET", emptyMap())).getOrThrow()
        Thread.sleep(300)
        http.cancel("c")
        Thread.sleep(500)
        val n = sink.of("httpData", "c").size
        Thread.sleep(500)
        assertEquals(n, sink.of("httpData", "c").size)
        assertTrue(sink.of("httpEnd", "c").isEmpty())
        assertTrue(sink.of("httpError", "c").isEmpty())
    }

    @Test
    fun connectionFailuresRejectWithNodeCodes() {
        val port = server.port
        server.close()
        val r = request(HttpOptions("f", "http://127.0.0.1:$port/", "GET", emptyMap()))
        assertEquals("ECONNREFUSED connect ECONNREFUSED 127.0.0.1:$port", r.exceptionOrNull()!!.message)
        val bad = request(HttpOptions("u", "not a url", "GET", emptyMap()))
        assertTrue(bad.exceptionOrNull()!!.message!!.startsWith("ERR_INVALID_URL"))
    }
}
