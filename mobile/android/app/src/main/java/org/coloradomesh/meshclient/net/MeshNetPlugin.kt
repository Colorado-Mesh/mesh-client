package org.coloradomesh.meshclient.net

import android.content.Context
import android.net.wifi.WifiManager
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
import org.coloradomesh.meshclient.bridge.resolveMap
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.UnknownHostException
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * `MeshNet` (contract: `MeshNetPlugin` in src/mobile/native/contracts.ts; reference
 * implementation: scripts/mobile-web-bridge.mjs). Capacitor runs every plugin method on one
 * shared "CapacitorPlugins" thread, so anything that can block (connect, DNS, bind, send) runs on
 * [io]; per-socket ordering is kept by the engines' single-thread writers.
 */
@CapacitorPlugin(name = "MeshNet")
class MeshNetPlugin : Plugin() {
    private val io: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "MeshNet-io").apply { isDaemon = true } }
    private val sink = EventSink { event, data -> notifyListeners(event, JsConvert.obj(data)) }
    private var multicastLock: WifiManager.MulticastLock? = null

    private lateinit var tcp: TcpEngine
    private lateinit var udp: UdpEngine
    private lateinit var http: HttpEngine
    private lateinit var ws: WsEngine

    override fun load() {
        tcp = TcpEngine(sink)
        udp = UdpEngine(sink) { needed -> setMulticastLock(needed) }
        val client = HttpEngine.defaultClient()
        http = HttpEngine(sink, client)
        ws = WsEngine(sink, client)
    }

    override fun handleOnDestroy() {
        tcp.shutdown()
        udp.shutdown()
        http.shutdown()
        ws.shutdown()
        setMulticastLock(false)
        io.shutdownNow()
    }

    private fun setMulticastLock(needed: Boolean) {
        try {
            if (needed) {
                val lock = multicastLock ?: (context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
                    .createMulticastLock("MeshClient:udp").apply { setReferenceCounted(false) }
                multicastLock = lock
                if (!lock.isHeld) lock.acquire()
            } else {
                multicastLock?.let { if (it.isHeld) it.release() }
            }
        } catch (e: Exception) {
            Log.w(TAG, "multicast lock: ${e.javaClass.simpleName}")
        }
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

    private fun PluginCall.requireString(key: String): String = getString(key)?.takeIf { it.isNotEmpty() } ?: throw PluginError("ERR_INVALID_ARG_TYPE missing $key")

    // ── TCP / TLS ───────────────────────────────────────────────────────────

    @PluginMethod
    fun tcpConnect(call: PluginCall) = background(call) {
        val o = TcpConnectOptions(
            id = call.requireString("id"),
            host = call.getString("host") ?: "localhost",
            port = call.getInt("port") ?: throw PluginError("ERR_SOCKET_BAD_PORT missing port"),
            tls = call.getBoolean("tls", false) == true,
            servername = call.getString("servername"),
            rejectUnauthorized = call.getBoolean("rejectUnauthorized", true) != false,
            material = TlsMaterial.fromB64(
                JsConvert.stringList(call, "caB64"),
                call.getString("certB64"),
                call.getString("keyB64"),
                call.getString("pfxB64"),
                call.getString("passphrase"),
            ),
            alpn = JsConvert.stringList(call, "alpn"),
            noDelay = call.getBoolean("noDelay", true) != false,
            keepAlive = call.getBoolean("keepAlive", false) == true,
            timeoutMs = call.getInt("timeoutMs") ?: TcpConnectOptions.DEFAULT_CONNECT_TIMEOUT_MS,
        )
        tcp.connect(o) { info -> call.resolveMap(info) }
    }

    @PluginMethod
    fun tcpWrite(call: PluginCall) {
        val id = call.getString("id") ?: return call.reject("EPIPE write EPIPE (socket closed)")
        tcp.write(id, Codec.unb64(call.getString("dataB64"))) { err -> if (err == null) call.resolve() else call.rejectWith(err) }
    }

    @PluginMethod
    fun tcpEnd(call: PluginCall) {
        val id = call.getString("id") ?: return call.resolve()
        tcp.end(id) { err -> if (err == null) call.resolve() else call.rejectWith(err) }
    }

    @PluginMethod
    fun tcpDestroy(call: PluginCall) {
        call.getString("id")?.let { tcp.destroy(it) }
        call.resolve()
    }

    @PluginMethod
    fun tcpSetOptions(call: PluginCall) {
        val id = call.getString("id") ?: return call.resolve()
        tcp.setOptions(id, call.getBoolean("noDelay"), call.getBoolean("keepAlive"))
        call.resolve()
    }

    @PluginMethod
    fun tcpListen(call: PluginCall) = background(call) {
        val tlsObj = call.getObject("tls")
        val tls = tlsObj?.let {
            TcpServerTls(
                material = TlsMaterial.fromB64(
                    caList(it),
                    it.optString("certB64").takeIf { s -> s.isNotEmpty() },
                    it.optString("keyB64").takeIf { s -> s.isNotEmpty() },
                    it.optString("pfxB64").takeIf { s -> s.isNotEmpty() },
                    if (it.has("passphrase")) it.optString("passphrase") else null,
                ),
                requestCert = it.optBoolean("requestCert", false),
                rejectUnauthorized = it.optBoolean("rejectUnauthorized", true),
            )
        }
        val r = tcp.listen(TcpListenOptions(call.requireString("id"), call.getString("host") ?: "127.0.0.1", call.getInt("port") ?: 0, tls))
        call.resolveMap(r)
    }

    @PluginMethod
    fun tcpServerClose(call: PluginCall) {
        call.getString("id")?.let { tcp.serverClose(it) }
        call.resolve()
    }

    /** `caB64?: string | string[]` inside the `tls` object of `tcpListen`. */
    private fun caList(o: org.json.JSONObject): List<String> {
        if (!o.has("caB64") || o.isNull("caB64")) return emptyList()
        val raw = o.get("caB64")
        if (raw is org.json.JSONArray) return (0 until raw.length()).mapNotNull { i -> raw.optString(i).takeIf { it.isNotEmpty() } }
        return listOfNotNull(raw.toString().takeIf { it.isNotEmpty() })
    }

    // ── UDP ─────────────────────────────────────────────────────────────────

    @PluginMethod
    fun udpCreate(call: PluginCall) = background(call) {
        udp.create(call.requireString("id"), call.getString("type") ?: "udp4", call.getBoolean("reuseAddr", false) == true)
        call.resolve()
    }

    @PluginMethod
    fun udpBind(call: PluginCall) = background(call) {
        val r = udp.bind(call.requireString("id"), call.getInt("port") ?: 0, call.getString("address") ?: "0.0.0.0")
        call.resolveMap(r)
    }

    @PluginMethod
    fun udpSend(call: PluginCall) = background(call) {
        udp.send(
            call.requireString("id"),
            Codec.unb64(call.getString("dataB64")),
            call.getInt("port") ?: throw PluginError("ERR_SOCKET_BAD_PORT missing port"),
            call.getString("address") ?: "127.0.0.1",
        )
        call.resolve()
    }

    @PluginMethod
    fun udpClose(call: PluginCall) {
        call.getString("id")?.let { udp.close(it) }
        call.resolve()
    }

    @PluginMethod
    fun udpSetOptions(call: PluginCall) = background(call) {
        udp.setOptions(call.requireString("id"), call.getBoolean("broadcast"), call.getInt("multicastTtl"), call.getBoolean("multicastLoopback"))
        call.resolve()
    }

    @PluginMethod
    fun udpAddMembership(call: PluginCall) = background(call) {
        udp.addMembership(call.requireString("id"), call.requireString("group"), call.getString("iface"))
        call.resolve()
    }

    @PluginMethod
    fun udpDropMembership(call: PluginCall) = background(call) {
        udp.dropMembership(call.requireString("id"), call.requireString("group"), call.getString("iface"))
        call.resolve()
    }

    // ── DNS ─────────────────────────────────────────────────────────────────

    @PluginMethod
    fun dnsLookup(call: PluginCall) = background(call) {
        val hostname = call.requireString("hostname")
        val family = call.getInt("family") ?: 0
        val all = try {
            IpLiteral.parse(hostname)?.let { arrayOf(it) } ?: InetAddress.getAllByName(hostname)
        } catch (e: UnknownHostException) {
            throw PluginError("ENOTFOUND getaddrinfo ENOTFOUND $hostname", e)
        }
        val list = all.filter { a -> family == 0 || (family == 4 && a is Inet4Address) || (family == 6 && a is Inet6Address) }
        if (list.isEmpty()) throw PluginError("ENOTFOUND getaddrinfo ENOTFOUND $hostname")
        val arr = JSArray()
        list.forEach { a -> arr.put(JSObject().put("address", a.hostAddress).put("family", IpLiteral.familyNumber(a))) }
        call.resolve(JSObject().put("addresses", arr))
    }

    // ── HTTP ────────────────────────────────────────────────────────────────

    @PluginMethod
    fun httpRequest(call: PluginCall) {
        val id = call.getString("id")
        val url = call.getString("url")
        if (id.isNullOrEmpty() || url.isNullOrEmpty()) return call.reject("ERR_INVALID_ARG_TYPE missing id or url")
        val o = HttpOptions(
            id = id,
            url = url,
            method = call.getString("method") ?: "GET",
            headers = JsConvert.stringMap(call.getObject("headers")),
            body = call.getString("bodyB64")?.takeIf { it.isNotEmpty() }?.let { Codec.unb64(it) },
            followRedirects = call.getBoolean("followRedirects", true) != false,
        )
        http.request(o, onStart = { call.resolveMap(it) }, onFail = { call.reject(it) })
    }

    @PluginMethod
    fun httpCancel(call: PluginCall) {
        call.getString("id")?.let { http.cancel(it) }
        call.resolve()
    }

    // ── WebSocket ───────────────────────────────────────────────────────────

    @PluginMethod
    fun wsConnect(call: PluginCall) {
        try {
            ws.connect(
                WsOptions(
                    id = call.requireString("id"),
                    url = call.requireString("url"),
                    headers = JsConvert.stringMap(call.getObject("headers")),
                    protocols = JsConvert.stringList(call, "protocols"),
                    timeoutMs = call.getInt("timeoutMs"),
                    rejectUnauthorized = call.getBoolean("rejectUnauthorized", true) != false,
                ),
            )
            call.resolve()
        } catch (e: Exception) {
            call.rejectWith(e)
        }
    }

    @PluginMethod
    fun wsSend(call: PluginCall) {
        try {
            val text = if (call.data.has("text") && !call.data.isNull("text")) call.getString("text") else null
            ws.send(call.requireString("id"), text, if (text == null) Codec.unb64(call.getString("dataB64")) else null)
            call.resolve()
        } catch (e: Exception) {
            call.rejectWith(e)
        }
    }

    @PluginMethod
    fun wsClose(call: PluginCall) {
        call.getString("id")?.let { ws.close(it, call.getInt("code") ?: 1000, call.getString("reason") ?: "") }
        call.resolve()
    }

    companion object {
        private const val TAG = "MeshNet"
    }
}
