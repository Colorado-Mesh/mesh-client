package org.coloradomesh.meshclient.usb

import org.coloradomesh.meshclient.bridge.PluginError
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class UsbParamsTest {
    @Test
    fun mapsWebSerialOptions() {
        assertEquals(UsbParams.Line(115200, 8, UsbParams.STOPBITS_1, UsbParams.PARITY_NONE), UsbParams.line(115200, null, null, null))
        assertEquals(UsbParams.Line(9600, 7, UsbParams.STOPBITS_2, UsbParams.PARITY_EVEN), UsbParams.line(9600, 7, 2, "even"))
        assertEquals(UsbParams.PARITY_ODD, UsbParams.line(9600, 8, 1, "ODD").parity)
    }

    @Test
    fun rejectsInvalidOptions() {
        assertThrows(PluginError::class.java) { UsbParams.line(null, 8, 1, "none") }
        assertThrows(PluginError::class.java) { UsbParams.line(0, 8, 1, "none") }
        assertThrows(PluginError::class.java) { UsbParams.line(9600, 9, 1, "none") }
        assertThrows(PluginError::class.java) { UsbParams.line(9600, 8, 3, "none") }
        assertThrows(PluginError::class.java) { UsbParams.line(9600, 8, 1, "mark") }
    }
}
