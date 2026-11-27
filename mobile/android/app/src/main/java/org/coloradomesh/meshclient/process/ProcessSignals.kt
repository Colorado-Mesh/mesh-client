package org.coloradomesh.meshclient.process

/** Node signal names <-> Linux signal numbers, and exit-status decoding (pure; unit-tested). */
object ProcessSignals {
    private val byName = mapOf(
        "SIGHUP" to 1, "SIGINT" to 2, "SIGQUIT" to 3, "SIGABRT" to 6, "SIGKILL" to 9,
        "SIGUSR1" to 10, "SIGUSR2" to 12, "SIGPIPE" to 13, "SIGALRM" to 14, "SIGTERM" to 15,
    )
    private val byNumber = byName.entries.associate { (k, v) -> v to k }

    /** `'SIGTERM'`, `'TERM'`, `'15'` -> 15; unknown -> null. Node's default signal is SIGTERM. */
    fun number(signal: String?): Int? {
        val s = signal?.trim()?.uppercase().orEmpty()
        if (s.isEmpty()) return 15
        s.toIntOrNull()?.let { return it.takeIf { n -> n in 1..64 } }
        return byName[s] ?: byName["SIG$s"]
    }

    fun name(number: Int): String? = byNumber[number]

    /**
     * Java reports a process killed by signal N as exit value 128+N. Node reports
     * `(code = null, signal = 'SIGxxx')` for those, so decode it when it matches the signal we
     * sent (a real exit code of 128+N from the program itself is otherwise left alone).
     */
    fun exitStatus(rawExitValue: Int, lastSignalSent: Int?): Pair<Int?, String?> {
        if (lastSignalSent != null && rawExitValue == 128 + lastSignalSent) {
            return null to (name(lastSignalSent) ?: "SIG$lastSignalSent")
        }
        return rawExitValue to null
    }
}
