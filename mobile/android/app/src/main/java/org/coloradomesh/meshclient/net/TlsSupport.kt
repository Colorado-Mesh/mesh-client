package org.coloradomesh.meshclient.net

import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.PluginError
import java.io.ByteArrayInputStream
import java.security.KeyStore
import java.security.SecureRandom
import java.security.cert.CertificateException
import java.security.cert.CertificateExpiredException
import java.security.cert.CertificateNotYetValidException
import java.security.cert.X509Certificate
import javax.net.ssl.KeyManager
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager

/** TLS material as received from the contract (`…B64` fields already decoded by the caller). */
data class TlsMaterial(
    val ca: List<ByteArray> = emptyList(),
    val cert: ByteArray? = null,
    val key: ByteArray? = null,
    val pfx: ByteArray? = null,
    val passphrase: String? = null,
) {
    companion object {
        fun fromB64(ca: List<String>, cert: String?, key: String?, pfx: String?, passphrase: String?) = TlsMaterial(
            ca = ca.filter { it.isNotEmpty() }.map { Codec.unb64(it) },
            cert = cert?.takeIf { it.isNotEmpty() }?.let { Codec.unb64(it) },
            key = key?.takeIf { it.isNotEmpty() }?.let { Codec.unb64(it) },
            pfx = pfx?.takeIf { it.isNotEmpty() }?.let { Codec.unb64(it) },
            passphrase = passphrase,
        )
    }
}

/**
 * Wraps the real trust manager, records the Node verification code of a failed chain, and only
 * throws when [reject] is set (`rejectUnauthorized`). With `rejectUnauthorized: false` the
 * handshake proceeds and the socket reports `authorized: false` + `authorizationError`, like Node.
 */
class RecordingTrustManager(private val delegate: X509TrustManager, private val reject: Boolean) : X509TrustManager {
    @Volatile
    var failureCode: String? = null
        private set

    @Volatile
    var verified = false
        private set

    override fun checkServerTrusted(chain: Array<out X509Certificate>, authType: String) =
        check(chain) { delegate.checkServerTrusted(chain, authType) }

    override fun checkClientTrusted(chain: Array<out X509Certificate>, authType: String) =
        check(chain) { delegate.checkClientTrusted(chain, authType) }

    override fun getAcceptedIssuers(): Array<X509Certificate> = delegate.acceptedIssuers

    private fun check(chain: Array<out X509Certificate>, verify: () -> Unit) {
        try {
            verify()
            // PKIX does not check the validity of a trust anchor, so an expired self-signed
            // certificate passed as `ca` (TAK servers, LAN brokers) would be accepted. OpenSSL /
            // Node reject it; check the leaf's dates ourselves.
            chain.firstOrNull()?.checkValidity()
            verified = true
            failureCode = null
        } catch (e: CertificateException) {
            val code = classify(chain)
            failureCode = code
            verified = false
            if (reject) throw CertificateException("$code ${NetErrors.CERT_MESSAGES[code] ?: e.message}", e)
        }
    }

    private fun classify(chain: Array<out X509Certificate>): String {
        var failure = CertFailure.UNTRUSTED
        for (c in chain) {
            try {
                c.checkValidity()
            } catch (_: CertificateExpiredException) {
                failure = CertFailure.EXPIRED
                break
            } catch (_: CertificateNotYetValidException) {
                failure = CertFailure.NOT_YET_VALID
                break
            }
        }
        fun selfIssued(c: X509Certificate) = c.subjectX500Principal == c.issuerX500Principal
        return CertClassifier.classify(
            failure = failure,
            chainLength = chain.size,
            leafSelfIssued = chain.firstOrNull()?.let(::selfIssued) == true,
            chainHasSelfIssued = chain.drop(1).any(::selfIssued),
        )
    }
}

/** Accepts every chain (`rejectUnauthorized: false` for OkHttp WebSockets). */
@Suppress("CustomX509TrustManager")
object TrustAllManager : X509TrustManager {
    @Suppress("TrustAllX509TrustManager")
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit

    @Suppress("TrustAllX509TrustManager")
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) = Unit

    override fun getAcceptedIssuers(): Array<X509Certificate> = emptyArray()
}

object TlsSupport {
    /** Default (system) trust, or only the given CAs — Node's `ca` option replaces the default roots. */
    fun baseTrustManager(ca: List<ByteArray>): X509TrustManager {
        val tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
        if (ca.isEmpty()) {
            tmf.init(null as KeyStore?)
        } else {
            val ks = KeyStore.getInstance(KeyStore.getDefaultType()).apply { load(null, null) }
            var n = 0
            for (blob in ca) {
                val certs = try {
                    Pem.certificates(blob)
                } catch (e: Exception) {
                    throw PluginError("ERR_OSSL_PEM_NO_START_LINE could not read a CA certificate", e)
                }
                for (c in certs) ks.setCertificateEntry("ca${n++}", c)
            }
            tmf.init(ks)
        }
        return tmf.trustManagers.filterIsInstance<X509TrustManager>().first()
    }

    fun keyManagers(m: TlsMaterial): Array<KeyManager>? {
        val pass = (m.passphrase ?: "").toCharArray()
        val ks: KeyStore = when {
            m.pfx != null -> try {
                KeyStore.getInstance("PKCS12").apply { load(ByteArrayInputStream(m.pfx), pass) }
            } catch (e: Exception) {
                throw PluginError("ERR_CRYPTO_PKCS12 could not read the PKCS#12 bundle (wrong passphrase?)", e)
            }
            m.cert != null && m.key != null -> {
                val chain = Pem.certificates(m.cert)
                if (chain.isEmpty()) throw PluginError("ERR_OSSL_PEM_NO_START_LINE no client certificate found")
                val key = Pem.privateKey(m.key, m.passphrase)
                KeyStore.getInstance("PKCS12").apply {
                    load(null, null)
                    setKeyEntry("client", key, pass, chain.toTypedArray())
                }
            }
            else -> return null
        }
        val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm())
        kmf.init(ks, pass)
        return kmf.keyManagers
    }

    fun context(keyManagers: Array<KeyManager>?, trust: TrustManager): SSLContext =
        SSLContext.getInstance("TLS").apply { init(keyManagers, arrayOf(trust), SecureRandom()) }
}
