package org.coloradomesh.meshclient.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class IpLiteralTest {
    @Test
    fun recognisesIpv4() {
        assertTrue(IpLiteral.isIpv4("10.0.2.2"))
        assertTrue(IpLiteral.isIpv4("255.255.255.255"))
        assertFalse(IpLiteral.isIpv4("256.1.1.1"))
        assertFalse(IpLiteral.isIpv4("1.2.3"))
        assertFalse(IpLiteral.isIpv4("meshtastic.local"))
    }

    @Test
    fun recognisesIpv6WithBracketsAndZones() {
        assertTrue(IpLiteral.isIpv6("::1"))
        assertTrue(IpLiteral.isIpv6("[fe80::1]"))
        assertTrue(IpLiteral.isIpv6("fe80::1%wlan0"))
        assertTrue(IpLiteral.isIpv6("::ffff:10.0.0.1"))
        assertFalse(IpLiteral.isIpv6("1:2:3:4:5:6:7:8:9"))
        assertFalse(IpLiteral.isIpv6("abc"))
        assertFalse(IpLiteral.isIpv6("1::2::3"))
    }

    @Test
    fun parsesLiteralsWithoutResolvingHostnames() {
        assertEquals("10.0.2.2", IpLiteral.parse("10.0.2.2")?.hostAddress)
        assertEquals(6, IpLiteral.familyNumber(IpLiteral.parse("[::1]")!!))
        assertNull(IpLiteral.parse("example.com"))
    }
}
