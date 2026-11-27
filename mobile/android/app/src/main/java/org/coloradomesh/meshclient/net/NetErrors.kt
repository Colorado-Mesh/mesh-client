package org.coloradomesh.meshclient.net

import java.io.EOFException
import java.io.InterruptedIOException
import java.net.BindException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.PortUnreachableException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateExpiredException
import java.security.cert.CertificateNotYetValidException
import javax.net.ssl.SSLException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

/**
 * Java/Android network exceptions -> Node-style error messages with the Node error code first
 * (`ECONNREFUSED connect ECONNREFUSED 10.0.2.2:5001`), matching what the reference bridge
 * (`scripts/mobile-web-bridge.mjs`) produces with `${e.code} ${e.message}`. The host shims parse
 * that leading code into `err.code`.
 */
object NetErrors {
    /** Certificate verification codes, as OpenSSL / Node name them, with Node's message text. */
    val CERT_MESSAGES: Map<String, String> = mapOf(
        "CERT_HAS_EXPIRED" to "certificate has expired",
        "CERT_NOT_YET_VALID" to "certificate is not yet valid",
        "DEPTH_ZERO_SELF_SIGNED_CERT" to "self-signed certificate",
        "SELF_SIGNED_CERT_IN_CHAIN" to "self-signed certificate in certificate chain",
        "UNABLE_TO_VERIFY_LEAF_SIGNATURE" to "unable to verify the first certificate",
        "UNABLE_TO_GET_ISSUER_CERT_LOCALLY" to "unable to get local issuer certificate",
        "ERR_TLS_CERT_ALTNAME_INVALID" to "Hostname/IP does not match certificate's altnames",
    )

    private val leadingCode = Regex("^([A-Z][A-Z0-9_]{2,})\\b")

    /** Node error code for [e] (walking the cause chain), or null when none applies. */
    fun code(e: Throwable): String? {
        var t: Throwable? = e
        var depth = 0
        while (t != null && depth < 8) {
            codeOf(t)?.let { return it }
            t = t.cause
            depth++
        }
        return null
    }

    private fun codeOf(t: Throwable): String? {
        val msg = t.message.orEmpty()
        // Messages we created ourselves (TLS verification, explicit errors) already lead with a code.
        leadingCode.find(msg)?.let { m ->
            val c = m.groupValues[1]
            if (c.startsWith("E") || c.startsWith("CERT_") || CERT_MESSAGES.containsKey(c)) return c
        }
        fun has(vararg needles: String) = needles.any { msg.contains(it, ignoreCase = true) }
        return when (t) {
            is UnknownHostException -> "ENOTFOUND"
            is SocketTimeoutException -> "ETIMEDOUT"
            is NoRouteToHostException -> "EHOSTUNREACH"
            is PortUnreachableException -> "ECONNREFUSED"
            is ConnectException -> when {
                has("ENETUNREACH", "Network is unreachable") -> "ENETUNREACH"
                has("EHOSTUNREACH", "No route to host") -> "EHOSTUNREACH"
                has("ETIMEDOUT", "timed out") -> "ETIMEDOUT"
                has("EACCES", "Permission denied") -> "EACCES"
                else -> "ECONNREFUSED"
            }
            is BindException -> when {
                has("EADDRNOTAVAIL", "assign requested address") -> "EADDRNOTAVAIL"
                has("EACCES", "Permission denied") -> "EACCES"
                else -> "EADDRINUSE"
            }
            is CertificateExpiredException -> "CERT_HAS_EXPIRED"
            is CertificateNotYetValidException -> "CERT_NOT_YET_VALID"
            is SSLPeerUnverifiedException -> "ERR_TLS_CERT_ALTNAME_INVALID"
            is SSLHandshakeException, is SSLException -> when {
                has("Connection reset", "ECONNRESET") -> "ECONNRESET"
                has("Broken pipe", "EPIPE") -> "EPIPE"
                else -> null // look at the cause (certificate problems), else EPROTO below
            }
            is SocketException -> when {
                has("ECONNRESET", "Connection reset") -> "ECONNRESET"
                has("EPIPE", "Broken pipe") -> "EPIPE"
                has("ECONNABORTED", "Software caused connection abort") -> "ECONNABORTED"
                has("ENETUNREACH", "Network is unreachable") -> "ENETUNREACH"
                has("EHOSTUNREACH", "No route to host") -> "EHOSTUNREACH"
                has("ETIMEDOUT", "timed out") -> "ETIMEDOUT"
                has("ECONNREFUSED", "Connection refused") -> "ECONNREFUSED"
                has("Socket closed", "Socket is closed") -> "ECONNRESET"
                else -> null
            }
            is EOFException -> "ECONNRESET"
            is InterruptedIOException -> "ETIMEDOUT"
            else -> null
        }
    }

    /**
     * `<CODE> <syscall> <CODE> <target>` like Node (`connect ECONNREFUSED 127.0.0.1:4403`,
     * `getaddrinfo ENOTFOUND host`). TLS failures become `<CODE> <node message>`.
     */
    fun describe(e: Throwable, syscall: String, target: String?): String {
        val c = code(e) ?: if (e is SSLException) "EPROTO" else null
        if (c == null) return e.message ?: e.javaClass.simpleName
        CERT_MESSAGES[c]?.let { nodeMsg ->
            val own = e.message.orEmpty()
            // Keep the detail of messages we generated ("ERR_TLS_CERT_ALTNAME_INVALID Hostname/IP ...").
            return if (own.startsWith("$c ")) own else "$c $nodeMsg"
        }
        if (c == "EPROTO") return "EPROTO ${e.message ?: "TLS handshake failed"}"
        val sys = if (c == "ENOTFOUND") "getaddrinfo" else syscall
        return listOfNotNull(c, sys, c, target).joinToString(" ")
    }

    /** `host:port`, with IPv6 literals unbracketed as Node prints them. */
    fun target(host: String, port: Int): String = "$host:$port"
}

/** Certificate failure kinds the trust manager can observe (input to [CertClassifier]). */
enum class CertFailure { EXPIRED, NOT_YET_VALID, UNTRUSTED }

/** Maps a failed chain to the OpenSSL / Node verification code (pure; unit-tested). */
object CertClassifier {
    /**
     * @param chainLength certificates presented by the peer
     * @param leafSelfIssued leaf subject == issuer
     * @param chainHasSelfIssued some certificate after the leaf is self-issued (a root)
     */
    fun classify(failure: CertFailure, chainLength: Int, leafSelfIssued: Boolean, chainHasSelfIssued: Boolean): String = when (failure) {
        CertFailure.EXPIRED -> "CERT_HAS_EXPIRED"
        CertFailure.NOT_YET_VALID -> "CERT_NOT_YET_VALID"
        CertFailure.UNTRUSTED -> when {
            chainLength <= 1 && leafSelfIssued -> "DEPTH_ZERO_SELF_SIGNED_CERT"
            chainHasSelfIssued -> "SELF_SIGNED_CERT_IN_CHAIN"
            chainLength <= 1 -> "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
            else -> "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
        }
    }
}
