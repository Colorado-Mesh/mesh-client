package org.coloradomesh.meshclient.process

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProcessSignalsTest {
    @Test
    fun parsesNodeSignalNames() {
        assertEquals(15, ProcessSignals.number("SIGTERM"))
        assertEquals(15, ProcessSignals.number(null))
        assertEquals(15, ProcessSignals.number(""))
        assertEquals(9, ProcessSignals.number("SIGKILL"))
        assertEquals(2, ProcessSignals.number("int"))
        assertEquals(9, ProcessSignals.number("9"))
        assertNull(ProcessSignals.number("SIGNOPE"))
        assertNull(ProcessSignals.number("99"))
    }

    @Test
    fun decodesSignalExitsOnlyForTheSignalWeSent() {
        assertEquals(null to "SIGTERM", ProcessSignals.exitStatus(143, 15))
        assertEquals(null to "SIGKILL", ProcessSignals.exitStatus(137, 9))
        assertEquals(143 to null, ProcessSignals.exitStatus(143, null))
        assertEquals(0 to null, ProcessSignals.exitStatus(0, 15)) // handled SIGTERM gracefully
        assertEquals(1 to null, ProcessSignals.exitStatus(1, null))
    }
}
