package org.coloradomesh.meshclient.net

import org.junit.Assert.assertEquals
import org.junit.Test
import java.io.EOFException
import java.net.BindException
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.cert.CertificateException
import java.security.cert.CertificateExpiredException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException

class NetErrorsTest {
    private val target = "10.0.2.2:5001"

    @Test
    fun connectFailuresUseNodeMessagesWithTheCodeFirst() {
        assertEquals("ECONNREFUSED connect ECONNREFUSED $target", NetErrors.describe(ConnectException("failed to connect to /10.0.2.2 (port 5001): connect failed: ECONNREFUSED (Connection refused)"), "connect", target))
        assertEquals("ETIMEDOUT connect ETIMEDOUT $target", NetErrors.describe(SocketTimeoutException("failed to connect within 20000ms"), "connect", target))
        assertEquals("ENETUNREACH connect ENETUNREACH $target", NetErrors.describe(ConnectException("connect failed: ENETUNREACH (Network is unreachable)"), "connect", target))
        assertEquals("EHOSTUNREACH connect EHOSTUNREACH $target", NetErrors.describe(NoRouteToHostException("No route to host"), "connect", target))
        assertEquals("ENOTFOUND getaddrinfo ENOTFOUND $target", NetErrors.describe(UnknownHostException("Unable to resolve host"), "connect", target))
    }

    @Test
    fun socketFailuresMapToNodeCodes() {
        assertEquals("ECONNRESET", NetErrors.code(SocketException("Connection reset")))
        assertEquals("ECONNRESET", NetErrors.code(SocketException("recvfrom failed: ECONNRESET (Connection reset by peer)")))
        assertEquals("EPIPE", NetErrors.code(SocketException("sendto failed: EPIPE (Broken pipe)")))
        assertEquals("ECONNABORTED", NetErrors.code(SocketException("Software caused connection abort")))
        assertEquals("ECONNRESET", NetErrors.code(EOFException()))
        assertEquals("EADDRINUSE", NetErrors.code(BindException("bind failed: EADDRINUSE (Address already in use)")))
        assertEquals("EADDRNOTAVAIL", NetErrors.code(BindException("Cannot assign requested address")))
        assertEquals("ECONNRESET read ECONNRESET", NetErrors.describe(SocketException("Connection reset"), "read", null))
    }

    @Test
    fun certificateFailuresUseOpenSslCodesFromTheCauseChain() {
        val ours = SSLHandshakeException("Handshake failed").apply { initCause(CertificateException("DEPTH_ZERO_SELF_SIGNED_CERT self-signed certificate")) }
        assertEquals("DEPTH_ZERO_SELF_SIGNED_CERT self-signed certificate", NetErrors.describe(ours, "connect", target))
        val expired = SSLHandshakeException("x").apply { initCause(CertificateExpiredException("NotAfter: ...")) }
        assertEquals("CERT_HAS_EXPIRED certificate has expired", NetErrors.describe(expired, "connect", target))
        assertEquals("ERR_TLS_CERT_ALTNAME_INVALID Hostname/IP does not match certificate's altnames", NetErrors.describe(SSLPeerUnverifiedException("Hostname example.com not verified"), "connect", target))
        assertEquals("EPROTO Handshake failed", NetErrors.describe(SSLHandshakeException("Handshake failed"), "connect", target))
    }

    @Test
    fun unknownErrorsKeepTheirMessage() {
        assertEquals("boom", NetErrors.describe(IllegalStateException("boom"), "connect", target))
        assertEquals("IllegalStateException", NetErrors.describe(IllegalStateException(), "connect", target))
    }

    @Test
    fun classifiesFailedChainsLikeOpenSsl() {
        assertEquals("CERT_HAS_EXPIRED", CertClassifier.classify(CertFailure.EXPIRED, 1, true, false))
        assertEquals("CERT_NOT_YET_VALID", CertClassifier.classify(CertFailure.NOT_YET_VALID, 2, false, false))
        assertEquals("DEPTH_ZERO_SELF_SIGNED_CERT", CertClassifier.classify(CertFailure.UNTRUSTED, 1, true, false))
        assertEquals("SELF_SIGNED_CERT_IN_CHAIN", CertClassifier.classify(CertFailure.UNTRUSTED, 3, false, true))
        assertEquals("UNABLE_TO_VERIFY_LEAF_SIGNATURE", CertClassifier.classify(CertFailure.UNTRUSTED, 1, false, false))
        assertEquals("UNABLE_TO_GET_ISSUER_CERT_LOCALLY", CertClassifier.classify(CertFailure.UNTRUSTED, 2, false, false))
    }
}
