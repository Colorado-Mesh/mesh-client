package org.coloradomesh.meshclient.usb

import org.coloradomesh.meshclient.bridge.PluginError

/**
 * Web Serial `open()` options -> usb-serial-for-android `setParameters` arguments (pure;
 * unit-tested). Constant values match `UsbSerialPort` (PARITY_NONE=0, ODD=1, EVEN=2;
 * STOPBITS_1=1, STOPBITS_2=2).
 */
object UsbParams {
    const val PARITY_NONE = 0
    const val PARITY_ODD = 1
    const val PARITY_EVEN = 2
    const val STOPBITS_1 = 1
    const val STOPBITS_2 = 2

    data class Line(val baudRate: Int, val dataBits: Int, val stopBits: Int, val parity: Int)

    fun line(baudRate: Int?, dataBits: Int?, stopBits: Int?, parity: String?): Line {
        val baud = baudRate ?: throw PluginError("TypeError baudRate is required")
        if (baud <= 0) throw PluginError("TypeError invalid baudRate $baud")
        val db = dataBits ?: 8
        if (db !in 5..8) throw PluginError("TypeError invalid dataBits $db")
        val sb = when (stopBits ?: 1) {
            1 -> STOPBITS_1
            2 -> STOPBITS_2
            else -> throw PluginError("TypeError invalid stopBits $stopBits")
        }
        val p = when ((parity ?: "none").lowercase()) {
            "none" -> PARITY_NONE
            "odd" -> PARITY_ODD
            "even" -> PARITY_EVEN
            else -> throw PluginError("TypeError invalid parity $parity")
        }
        return Line(baud, db, sb, p)
    }
}
