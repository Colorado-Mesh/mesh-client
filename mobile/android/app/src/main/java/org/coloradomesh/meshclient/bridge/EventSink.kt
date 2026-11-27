package org.coloradomesh.meshclient.bridge

/**
 * Event output of the plugin engines (`notifyListeners(event, data)` in production, a list in JVM
 * tests). Values are String / Number / Boolean / null / Map / List.
 */
fun interface EventSink {
    fun emit(event: String, data: Map<String, Any?>)
}

/** A value that must reach JS as `null` (plain Kotlin nulls are omitted from event objects). */
object JsNull {
    override fun toString() = "null"
}

/** Thrown by engines with a message already in the contract's error format (Node code first). */
class PluginError(message: String, cause: Throwable? = null) : Exception(message, cause)
