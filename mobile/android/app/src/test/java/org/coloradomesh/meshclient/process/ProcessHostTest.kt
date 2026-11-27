package org.coloradomesh.meshclient.process

import org.coloradomesh.meshclient.bridge.JsNull
import org.coloradomesh.meshclient.bridge.PluginError
import org.coloradomesh.meshclient.bridge.RecordingSink
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Drives ProcessHost with /bin/sh standing in for the packaged sidecar. */
class ProcessHostTest {
    private val sink = RecordingSink()
    private lateinit var work: File
    private lateinit var host: ProcessHost

    @Before
    fun setUp() {
        assumeTrue(File("/bin/sh").canExecute())
        work = Files.createTempDirectory("mesh-proc-").toFile()
        host = ProcessHost(
            sink = sink,
            executable = { File("/bin/sh") },
            workDir = work,
            overrideEnv = { mapOf("TMPDIR" to work.absolutePath) },
            signalSender = { pid, sig -> ProcessBuilder("kill", "-$sig", "$pid").start().waitFor() == 0 },
        )
    }

    @After
    fun tearDown() {
        host.shutdown(500)
        work.deleteRecursively()
    }

    private fun exitOf(id: String): Map<String, Any?> {
        sink.await(what = "exit of $id") { sink.of("exit", id).isNotEmpty() }
        return sink.of("exit", id).single()
    }

    @Test
    fun pumpsStdoutAndStderrBeforeReportingTheExitCode() {
        val pid = host.spawn("p", listOf("-c", "echo out; echo err >&2; exit 3"), emptyMap())
        assertTrue(pid > 0)
        assertEquals(mapOf("id" to "p", "code" to 3, "signal" to JsNull), exitOf("p"))
        assertEquals("out\n", sink.text("stdout", "p"))
        assertEquals("err\n", sink.text("stderr", "p"))
        val order = sink.events.filter { it.second["id"] == "p" }.map { it.first }
        assertEquals("exit", order.last())
    }

    @Test
    fun appliesTheCallerEnvThenTheOverridesInTheWorkDir() {
        host.spawn("e", listOf("-c", "printf '%s|%s|%s' \"\$RUST_LOG\" \"\$TMPDIR\" \"\$PWD\""), mapOf("RUST_LOG" to "info", "TMPDIR" to "/virtual/tmp"))
        exitOf("e")
        assertEquals("info|${work.absolutePath}|${work.canonicalPath}", sink.text("stdout", "e"))
    }

    @Test
    fun stdinIsWrittenInOrderAndClosed() {
        host.spawn("c", listOf("-c", "cat"), emptyMap())
        val latch = CountDownLatch(51)
        repeat(50) { i -> host.writeStdin("c", "line$i\n".toByteArray()) { latch.countDown() } }
        host.closeStdin("c") { latch.countDown() }
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertEquals(0, exitOf("c")["code"])
        assertEquals((0 until 50).joinToString("") { "line$it\n" }, sink.text("stdout", "c"))
    }

    @Test
    fun killReportsTheSignalLikeNode() {
        host.spawn("k", listOf("-c", "sleep 30"), emptyMap())
        Thread.sleep(200)
        host.kill("k", "SIGTERM")
        assertEquals(mapOf("id" to "k", "code" to JsNull, "signal" to "SIGTERM"), exitOf("k"))
    }

    @Test
    fun missingExecutableRejectsWithEnoent() {
        val none = ProcessHost(sink, { null }, work, signalSender = { _, _ -> false })
        val e = assertThrows(PluginError::class.java) { none.spawn("x", emptyList(), emptyMap()) }
        assertTrue(e.message!!.startsWith("ENOENT"))
    }

    @Test
    fun writesToExitedProcessesFailWithEpipe() {
        val latch = CountDownLatch(1)
        var err: Throwable? = null
        host.writeStdin("gone", ByteArray(1)) { err = it; latch.countDown() }
        latch.await(1, TimeUnit.SECONDS)
        assertTrue(err!!.message!!.startsWith("EPIPE"))
        host.kill("gone", "SIGKILL") // unknown ids are ignored
    }

    @Test
    fun unknownSignalsAreRejected() {
        host.spawn("s", listOf("-c", "sleep 5"), emptyMap())
        assertThrows(PluginError::class.java) { host.kill("s", "SIGBOGUS") }
        host.kill("s", "SIGKILL")
        assertEquals("SIGKILL", exitOf("s")["signal"])
    }
}
