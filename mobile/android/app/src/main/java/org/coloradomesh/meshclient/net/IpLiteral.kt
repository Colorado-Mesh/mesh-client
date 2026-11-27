package org.coloradomesh.meshclient.net

import java.net.Inet6Address
import java.net.InetAddress

/**
 * IP literal checks without DNS (pure; unit-tested). `InetAddress.getByName` on a hostname would
 * resolve it, so callers that must not resolve (pinned addresses, SNI decisions) check first.
 */
object IpLiteral {
    private val ipv4 = Regex("^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$")
    private val ipv6Chars = Regex("^[0-9A-Fa-f:.]+$")

    fun isIpv4(s: String): Boolean = ipv4.matches(s)

    /** IPv6 literal, optionally bracketed and with a `%scope` zone id. */
    fun isIpv6(s: String): Boolean {
        val core = unbracket(s).substringBefore('%')
        if (!core.contains(':') || !ipv6Chars.matches(core)) return false
        if (core.count { it == ':' } > 7) return false
        if (core.split("::").size > 2) return false
        val tail = core.substringAfterLast(':')
        if (tail.contains('.')) return isIpv4(tail)
        return core.split(':').all { it.length <= 4 }
    }

    fun isIp(s: String): Boolean = isIpv4(s) || isIpv6(s)

    fun unbracket(s: String): String = if (s.startsWith("[") && s.endsWith("]")) s.substring(1, s.length - 1) else s

    /** Parses a literal without DNS; null when [s] is not an IP literal. */
    fun parse(s: String): InetAddress? = if (isIp(s)) InetAddress.getByName(unbracket(s)) else null

    fun family(a: InetAddress): String = if (a is Inet6Address) "IPv6" else "IPv4"

    fun familyNumber(a: InetAddress): Int = if (a is Inet6Address) 6 else 4
}
