package org.coloradomesh.meshclient.net

import java.net.InetAddress
import java.security.cert.X509Certificate
import java.util.Locale

/**
 * Server identity check for raw TLS sockets (an `SSLSocket` does not verify hostnames). Follows
 * Node's `tls.checkServerIdentity`: IP hosts match IP SANs only; DNS hosts match DNS SANs with a
 * whole-label leftmost wildcard; the subject CN is used only when the certificate has no SANs.
 */
object HostnameCheck {
    private const val SAN_DNS = 2
    private const val SAN_IP = 7

    /** Pure matcher (unit-tested). Returns null when [host] matches, else Node's error message. */
    fun mismatch(host: String, dnsNames: List<String>, ipAddresses: List<String>, commonName: String?): String? {
        val h = IpLiteral.unbracket(host).trimEnd('.').lowercase(Locale.ROOT)
        val altnames = dnsNames.map { "DNS:$it" } + ipAddresses.map { "IP Address:$it" }
        if (IpLiteral.isIp(h)) {
            val want = IpLiteral.parse(h)
            val ok = ipAddresses.any { ip -> IpLiteral.parse(ip)?.let { sameAddress(it, want) } == true }
            return if (ok) null else "ERR_TLS_CERT_ALTNAME_INVALID Hostname/IP does not match certificate's altnames: IP: $h is not in the cert's list: ${altnames.joinToString(", ")}"
        }
        val candidates = if (dnsNames.isEmpty() && ipAddresses.isEmpty()) listOfNotNull(commonName) else dnsNames
        if (candidates.any { matchesPattern(h, it) }) return null
        val where = if (dnsNames.isEmpty() && ipAddresses.isEmpty()) "cert's CN: ${commonName.orEmpty()}" else "cert's altnames: ${altnames.joinToString(", ")}"
        return "ERR_TLS_CERT_ALTNAME_INVALID Hostname/IP does not match certificate's altnames: Host: $h. is not $where"
    }

    private fun sameAddress(a: InetAddress, b: InetAddress?): Boolean = b != null && a.address.contentEquals(b.address)

    fun matchesPattern(host: String, pattern: String): Boolean {
        val p = pattern.trimEnd('.').lowercase(Locale.ROOT)
        if (p.isEmpty()) return false
        if (!p.contains('*')) return p == host
        val pLabels = p.split('.')
        val hLabels = host.split('.')
        // Wildcard only as the entire leftmost label, never covering a public suffix alone.
        if (pLabels[0] != "*" || pLabels.drop(1).any { it.contains('*') } || pLabels.size < 3) return false
        if (hLabels.size != pLabels.size || hLabels[0].isEmpty()) return false
        return hLabels.drop(1) == pLabels.drop(1)
    }

    /** Checks [cert] against [host]; null when it matches. */
    fun check(host: String, cert: X509Certificate): String? {
        val dns = mutableListOf<String>()
        val ips = mutableListOf<String>()
        try {
            cert.subjectAlternativeNames?.forEach { entry ->
                val type = entry.getOrNull(0) as? Int ?: return@forEach
                val value = entry.getOrNull(1) as? String ?: return@forEach
                if (type == SAN_DNS) dns += value
                if (type == SAN_IP) ips += value
            }
        } catch (_: Exception) {
            // Unparseable SAN extension: treat as no SANs (falls back to CN, then fails closed).
        }
        val cn = Regex("(?:^|,)\\s*CN=([^,]+)").find(cert.subjectX500Principal.getName("RFC2253"))?.groupValues?.get(1)
        return mismatch(host, dns, ips, cn)
    }
}
