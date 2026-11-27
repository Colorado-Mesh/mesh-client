package org.coloradomesh.meshclient.net

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HostnameCheckTest {
    @Test
    fun matchesExactAndWildcardDnsNames() {
        assertNull(HostnameCheck.mismatch("mqtt.example.com", listOf("mqtt.example.com"), emptyList(), null))
        assertNull(HostnameCheck.mismatch("MQTT.Example.com.", listOf("mqtt.example.com"), emptyList(), null))
        assertNull(HostnameCheck.mismatch("a.example.com", listOf("*.example.com"), emptyList(), null))
    }

    @Test
    fun wildcardsCoverExactlyOneLeftmostLabel() {
        assertTrue(HostnameCheck.mismatch("a.b.example.com", listOf("*.example.com"), emptyList(), null)!!.startsWith("ERR_TLS_CERT_ALTNAME_INVALID "))
        assertTrue(HostnameCheck.mismatch("example.com", listOf("*.example.com"), emptyList(), null) != null)
        assertTrue(HostnameCheck.mismatch("a.com", listOf("*.com"), emptyList(), null) != null)
        assertTrue(HostnameCheck.mismatch("ab.example.com", listOf("a*.example.com"), emptyList(), null) != null)
    }

    @Test
    fun ipHostsMatchIpSansOnly() {
        assertNull(HostnameCheck.mismatch("10.0.2.2", emptyList(), listOf("10.0.2.2"), null))
        assertNull(HostnameCheck.mismatch("::1", emptyList(), listOf("0:0:0:0:0:0:0:1"), null))
        val m = HostnameCheck.mismatch("10.0.2.2", listOf("10.0.2.2"), emptyList(), "10.0.2.2")
        assertEquals("ERR_TLS_CERT_ALTNAME_INVALID Hostname/IP does not match certificate's altnames: IP: 10.0.2.2 is not in the cert's list: DNS:10.0.2.2", m)
    }

    @Test
    fun commonNameIsUsedOnlyWithoutSubjectAltNames() {
        assertNull(HostnameCheck.mismatch("tak.local", emptyList(), emptyList(), "tak.local"))
        assertTrue(HostnameCheck.mismatch("tak.local", listOf("other.local"), emptyList(), "tak.local") != null)
    }

    @Test
    fun checksRealCertificates() {
        val c = TestCerts.selfSigned(dns = listOf("mesh.local"), ips = listOf(byteArrayOf(192.toByte(), 168.toByte(), 1, 5)))
        assertNull(HostnameCheck.check("mesh.local", c.cert))
        assertNull(HostnameCheck.check("192.168.1.5", c.cert))
        assertTrue(HostnameCheck.check("other.local", c.cert)!!.contains("DNS:mesh.local"))
    }
}
