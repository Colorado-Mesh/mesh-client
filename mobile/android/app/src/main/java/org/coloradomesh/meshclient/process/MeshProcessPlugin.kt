package org.coloradomesh.meshclient.process

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.EventSink
import org.coloradomesh.meshclient.bridge.JsConvert
import org.coloradomesh.meshclient.bridge.PluginError
import org.coloradomesh.meshclient.bridge.rejectWith
import org.coloradomesh.meshclient.device.MeshDevicePlugin
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * `MeshProcess` (contract: `MeshProcessPlugin` in src/mobile/native/contracts.ts): runs the
 * Reticulum sidecar packaged as `jniLibs/<abi>/libmesh_client_reticulum.so` (extracted to
 * nativeLibraryDir, the only app location Android lets an app exec from), plus file access to the
 * shared Reticulum directory `<filesDir>/mesh-reticulum`.
 */
@CapacitorPlugin(name = "MeshProcess")
class MeshProcessPlugin : Plugin() {
    private val io: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "MeshProcess-io").apply { isDaemon = true } }
    private lateinit var host: ProcessHost
    private lateinit var shared: SharedDir

    override fun load() {
        val ctx = context
        shared = SharedDir(File(ctx.filesDir, SHARED_DIR_NAME))
        host = ProcessHost(
            sink = EventSink { event, data -> notifyListeners(event, JsConvert.obj(data)) },
            executable = { File(ctx.applicationInfo.nativeLibraryDir, MeshDevicePlugin.SIDECAR_LIBRARY).takeIf { it.isFile } },
            workDir = shared.root,
            // Merged over the env the JS passes: rns-runtime spools to tempfile(), and Android's
            // default temp dir (/data/local/tmp) is not writable by the app.
            overrideEnv = {
                mapOf(
                    "HOME" to ctx.filesDir.absolutePath,
                    "TMPDIR" to ctx.cacheDir.absolutePath,
                )
            },
            signalSender = { pid, sig ->
                try {
                    android.os.Process.sendSignal(pid.toInt(), sig)
                    true
                } catch (e: Exception) {
                    Log.w(TAG, "sendSignal failed: ${e.javaClass.simpleName}")
                    false
                }
            },
        )
    }

    override fun handleOnDestroy() {
        // The sidecar must not outlive the activity's WebView (it would hold ports and the BLE radio).
        host.shutdown()
        io.shutdownNow()
    }

    private inline fun background(call: PluginCall, crossinline block: () -> Unit) {
        io.execute {
            try {
                block()
            } catch (e: Exception) {
                call.rejectWith(e)
            }
        }
    }

    @PluginMethod
    fun spawn(call: PluginCall) = background(call) {
        val id = call.getString("id") ?: throw PluginError("ERR_INVALID_ARG_TYPE missing id")
        val program = call.getString("program")
        if (program != "reticulum-sidecar") throw PluginError("ENOENT spawn $program ENOENT")
        val args = JsConvert.stringList(call, "args")
        val env = JsConvert.stringMap(call.getObject("env"))
        shared.ensure()
        val pid = host.spawn(id, args, env)
        Log.i(TAG, "sidecar started pid=$pid")
        call.resolve(JSObject().put("pid", pid))
    }

    @PluginMethod
    fun writeStdin(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("EPIPE write EPIPE")
        host.writeStdin(id, Codec.unb64(call.getString("dataB64"))) { err -> if (err == null) call.resolve() else call.rejectWith(err) }
    }

    @PluginMethod
    fun closeStdin(call: PluginCall) {
        val id = call.getString("id") ?: return call.resolve()
        host.closeStdin(id) { err -> if (err == null) call.resolve() else call.rejectWith(err) }
    }

    @PluginMethod
    fun kill(call: PluginCall) {
        try {
            call.getString("id")?.let { host.kill(it, call.getString("signal")) }
            call.resolve()
        } catch (e: Exception) {
            call.rejectWith(e)
        }
    }

    @PluginMethod
    fun getSharedDir(call: PluginCall) = background(call) {
        call.resolve(JSObject().put("path", shared.ensure().absolutePath))
    }

    @PluginMethod
    fun sharedList(call: PluginCall) = background(call) {
        val arr = JSArray()
        shared.list(call.getString("path")).forEach { e ->
            arr.put(JSObject().put("path", e.path).put("size", e.size).put("mtimeMs", e.mtimeMs))
        }
        call.resolve(JSObject().put("files", arr))
    }

    @PluginMethod
    fun sharedRead(call: PluginCall) = background(call) {
        call.resolve(JSObject().put("dataB64", Codec.b64(shared.read(call.getString("path")))))
    }

    @PluginMethod
    fun sharedWrite(call: PluginCall) = background(call) {
        shared.write(call.getString("path"), Codec.unb64(call.getString("dataB64")))
        call.resolve()
    }

    @PluginMethod
    fun sharedRemove(call: PluginCall) = background(call) {
        shared.remove(call.getString("path"))
        call.resolve()
    }

    companion object {
        private const val TAG = "MeshProcess"
        const val SHARED_DIR_NAME = "mesh-reticulum"
    }
}
