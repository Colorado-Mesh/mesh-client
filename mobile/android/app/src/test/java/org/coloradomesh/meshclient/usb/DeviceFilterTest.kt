package org.coloradomesh.meshclient.usb

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import javax.xml.parsers.DocumentBuilderFactory

/** The USB_DEVICE_ATTACHED filter offers Mesh Client for the common radio USB vendors + any CDC-ACM device. */
class DeviceFilterTest {
    private val filter = File("src/main/res/xml/device_filter.xml")

    private fun entries(): List<Map<String, String>> {
        val doc = DocumentBuilderFactory.newInstance().newDocumentBuilder().parse(filter)
        val nodes = doc.getElementsByTagName("usb-device")
        return (0 until nodes.length).map { i ->
            val attrs = nodes.item(i).attributes
            (0 until attrs.length).associate { a -> attrs.item(a).nodeName to attrs.item(a).nodeValue }
        }
    }

    @Test
    fun coversCommonRadioVendors() {
        val vids = entries().mapNotNull { it["vendor-id"]?.toInt() }.toSet()
        // RAKwireless/Adafruit, Espressif, Silicon Labs, WCH, FTDI, Nordic, Seeed, Raspberry Pi, Prolific
        for (vid in listOf(0x239a, 0x303a, 0x10c4, 0x1a86, 0x0403, 0x1915, 0x2886, 0x2e8a, 0x067b)) {
            assertTrue("missing vendor 0x%04x".format(vid), vid in vids)
        }
    }

    @Test
    fun matchesAnyCdcAcmDevice() {
        assertTrue(entries().any { it["class"] == "2" && it.size == 1 })
    }

    @Test
    fun usesDecimalIdsAndanAndroidKnownAttributeSet() {
        val allowed = setOf("vendor-id", "product-id", "class", "subclass", "protocol", "manufacturer-name", "product-name", "serial-number")
        for (e in entries()) {
            assertTrue(e.toString(), e.keys.all { it in allowed })
            e["vendor-id"]?.let { assertTrue("vendor-id must be decimal: $it", it.all(Char::isDigit)) }
        }
    }
}
