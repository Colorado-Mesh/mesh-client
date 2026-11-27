package org.coloradomesh.meshclient.bridge

import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.json.JSONObject

/** Kotlin map/list values -> Capacitor JSObject / JSArray (nulls omitted; [JsNull] -> JSON null). */
object JsConvert {
    fun obj(map: Map<String, Any?>): JSObject {
        val o = JSObject()
        for ((k, v) in map) {
            if (v == null) continue
            o.put(k, value(v))
        }
        return o
    }

    private fun value(v: Any): Any = when (v) {
        is JsNull -> JSONObject.NULL
        is Map<*, *> -> obj(v.entries.associate { (k, x) -> k.toString() to x })
        is List<*> -> JSArray().also { a -> v.forEach { x -> a.put(if (x == null) JSONObject.NULL else value(x)) } }
        is Array<*> -> value(v.toList())
        else -> v
    }

    /** `JSObject` -> string map (header records). */
    fun stringMap(o: JSONObject?): Map<String, String> {
        if (o == null) return emptyMap()
        val out = LinkedHashMap<String, String>()
        val keys = o.keys()
        while (keys.hasNext()) {
            val k = keys.next()
            if (o.isNull(k)) continue
            out[k] = o.get(k).toString()
        }
        return out
    }

    /** Array option that may be a single string (`caB64?: string | string[]`). */
    fun stringList(call: PluginCall, key: String): List<String> {
        val data = call.data
        if (!data.has(key) || data.isNull(key)) return emptyList()
        val raw = data.get(key)
        if (raw is org.json.JSONArray) {
            return (0 until raw.length()).mapNotNull { i -> if (raw.isNull(i)) null else raw.get(i).toString() }
        }
        return listOf(raw.toString())
    }
}

fun PluginCall.resolveMap(map: Map<String, Any?>) = resolve(JsConvert.obj(map))

fun PluginCall.rejectWith(e: Throwable) {
    val msg = when (e) {
        is PluginError -> e.message
        else -> e.message ?: e.javaClass.simpleName
    } ?: "Unknown error"
    reject(msg)
}
