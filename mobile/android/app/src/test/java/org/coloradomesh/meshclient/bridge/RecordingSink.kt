package org.coloradomesh.meshclient.bridge

import java.util.concurrent.CopyOnWriteArrayList

/** Collects engine events for assertions. */
class RecordingSink : EventSink {
    val events = CopyOnWriteArrayList<Pair<String, Map<String, Any?>>>()

    override fun emit(event: String, data: Map<String, Any?>) {
        events += event to data
    }

    fun of(event: String, id: String? = null): List<Map<String, Any?>> =
        events.filter { it.first == event && (id == null || it.second["id"] == id) }.map { it.second }

    fun text(event: String, id: String): String =
        of(event, id).joinToString("") { String(Codec.unb64(it["dataB64"] as String)) }

    /** Polls until [cond] holds (or fails after [timeoutMs]). */
    fun await(timeoutMs: Long = 5_000, what: String = "condition", cond: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        while (!cond()) {
            if (System.currentTimeMillis() > deadline) throw AssertionError("timed out waiting for $what; events=$events")
            Thread.sleep(10)
        }
    }
}
