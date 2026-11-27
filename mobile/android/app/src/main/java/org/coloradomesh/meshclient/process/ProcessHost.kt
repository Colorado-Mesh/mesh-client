package org.coloradomesh.meshclient.process

import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.EventSink
import org.coloradomesh.meshclient.bridge.JsNull
import org.coloradomesh.meshclient.bridge.PluginError
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.TimeUnit

/**
 * Child processes for `MeshProcess` (pure JVM; tested with /bin/sh). Stdout/stderr are pumped on
 * their own threads as `stdout` / `stderr` events; `exit` fires once, after both pipes drained,
 * with Node's `(code, signal)` shape. Stdin writes are ordered on a per-process executor.
 *
 * @param executable resolves the program to run (null = not packaged -> ENOENT)
 * @param overrideEnv applied over the caller's env (Android: HOME / TMPDIR must be app dirs; the
 *   JS side only knows virtual paths and the default /data/local/tmp is not writable by the app)
 * @param signalSender delivers a signal to a pid; returns false when it could not
 */
class ProcessHost(
    private val sink: EventSink,
    private val executable: () -> File?,
    private val workDir: File,
    private val overrideEnv: () -> Map<String, String> = { emptyMap() },
    private val signalSender: (pid: Long, signal: Int) -> Boolean,
) {
    private val procs = ConcurrentHashMap<String, Proc>()
    private val threads: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "MeshProcess").apply { isDaemon = true } }

    fun spawn(id: String, args: List<String>, env: Map<String, String>): Long {
        val exe = executable()
        if (exe == null || !exe.isFile) throw PluginError("ENOENT spawn reticulum-sidecar ENOENT (sidecar is not packaged in this build)")
        if (procs.containsKey(id)) throw PluginError("EEXIST process id $id is already running")
        workDir.mkdirs()
        val pb = ProcessBuilder(listOf(exe.absolutePath) + args).directory(workDir)
        val e = pb.environment()
        e.putAll(env)
        e.putAll(overrideEnv())
        val process = try {
            pb.start()
        } catch (ex: IOException) {
            throw PluginError("ENOENT spawn reticulum-sidecar ENOENT: ${ex.message}", ex)
        }
        val p = Proc(id, process, pidOf(process))
        procs[id] = p
        p.start()
        return p.pid
    }

    fun writeStdin(id: String, bytes: ByteArray, done: (Throwable?) -> Unit) {
        val p = procs[id] ?: return done(PluginError("EPIPE write EPIPE (process exited)"))
        p.writeStdin(bytes, done)
    }

    fun closeStdin(id: String, done: (Throwable?) -> Unit) {
        val p = procs[id] ?: return done(null)
        p.closeStdin(done)
    }

    fun kill(id: String, signal: String?) {
        val p = procs[id] ?: return
        val sig = ProcessSignals.number(signal) ?: throw PluginError("ERR_UNKNOWN_SIGNAL Unknown signal: $signal")
        p.lastSignal = sig
        val sent = p.pid > 0 && signalSender(p.pid, sig)
        // Process.destroy() is the fallback when the pid is unknown (destroyForcibly is API 26).
        if (!sent) p.process.destroy()
    }

    /** Terminate everything (activity destroyed): SIGTERM, then SIGKILL after [graceMs]. */
    fun shutdown(graceMs: Long = 2_000) {
        val all = procs.values.toList()
        all.forEach { kill(it.id, "SIGTERM") }
        val deadline = System.currentTimeMillis() + graceMs
        // Poll our own exit flag (Process.waitFor(timeout) / isAlive are API 26).
        while (all.any { !it.exited } && System.currentTimeMillis() < deadline) {
            try {
                Thread.sleep(50)
            } catch (_: InterruptedException) {
                break
            }
        }
        all.filter { !it.exited }.forEach { kill(it.id, "SIGKILL") }
        threads.shutdown()
    }

    private inner class Proc(val id: String, val process: Process, val pid: Long) {
        private val stdinWriter = Executors.newSingleThreadExecutor { r -> Thread(r, "MeshProcess-stdin").apply { isDaemon = true } }

        @Volatile
        var lastSignal: Int? = null

        @Volatile
        var exited = false

        fun start() {
            val out = threads.submit { pump(process.inputStream, "stdout") }
            val err = threads.submit { pump(process.errorStream, "stderr") }
            threads.execute {
                val raw = try {
                    process.waitFor()
                } catch (_: InterruptedException) {
                    process.destroy()
                    -1
                }
                exited = true
                try {
                    out.get(2, TimeUnit.SECONDS)
                    err.get(2, TimeUnit.SECONDS)
                } catch (_: Exception) {
                    // pipes held open by a grandchild; report the exit anyway
                }
                procs.remove(id, this)
                stdinWriter.shutdown()
                val (code, signal) = ProcessSignals.exitStatus(raw, lastSignal)
                sink.emit("exit", mapOf("id" to id, "code" to (code ?: JsNull), "signal" to (signal ?: JsNull)))
            }
        }

        private fun pump(input: InputStream, event: String) {
            val buf = ByteArray(16 * 1024)
            try {
                input.use {
                    while (true) {
                        val n = it.read(buf)
                        if (n < 0) break
                        if (n > 0) sink.emit(event, mapOf("id" to id, "dataB64" to Codec.b64(buf, 0, n)))
                    }
                }
            } catch (_: IOException) {
                // process gone
            }
        }

        fun writeStdin(bytes: ByteArray, done: (Throwable?) -> Unit) {
            try {
                stdinWriter.execute {
                    try {
                        process.outputStream.write(bytes)
                        process.outputStream.flush()
                        done(null)
                    } catch (e: IOException) {
                        done(PluginError("EPIPE write EPIPE: ${e.message}", e))
                    }
                }
            } catch (_: RejectedExecutionException) {
                done(PluginError("EPIPE write EPIPE (process exited)"))
            }
        }

        fun closeStdin(done: (Throwable?) -> Unit) {
            try {
                stdinWriter.execute {
                    try {
                        process.outputStream.close()
                    } catch (_: IOException) {
                        // already closed
                    }
                    done(null)
                }
            } catch (_: RejectedExecutionException) {
                done(null)
            }
        }
    }

    companion object {
        /** `Process.pid()` (newer runtimes) or the implementation's `pid` field; 0 if unknown. */
        fun pidOf(p: Process): Long {
            try {
                val m = Process::class.java.getMethod("pid")
                return (m.invoke(p) as Number).toLong()
            } catch (_: Throwable) {
                // not available on this runtime
            }
            return try {
                val f = p.javaClass.getDeclaredField("pid")
                f.isAccessible = true
                (f.get(p) as Number).toLong()
            } catch (_: Throwable) {
                0L
            }
        }
    }
}
