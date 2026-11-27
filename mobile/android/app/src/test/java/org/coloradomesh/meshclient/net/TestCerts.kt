package org.coloradomesh.meshclient.net

import java.io.ByteArrayInputStream
import java.math.BigInteger
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.text.SimpleDateFormat
import java.util.Base64
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.net.ssl.KeyManagerFactory
import javax.net.ssl.SSLContext

/**
 * Self-signed RSA certificates built at test time (no private keys committed to the repo).
 * Minimal DER: v3 TBSCertificate with CN + subjectAltName, signed SHA256withRSA.
 */
object TestCerts {
    class Cert(val keyPair: KeyPair, val cert: X509Certificate) {
        val certPem: String get() = pem("CERTIFICATE", cert.encoded)
        val keyPkcs8Pem: String get() = pem("PRIVATE KEY", keyPair.private.encoded)

        fun serverContext(): SSLContext {
            val ks = KeyStore.getInstance("PKCS12").apply {
                load(null, null)
                setKeyEntry("k", keyPair.private, CharArray(0), arrayOf(cert))
            }
            val kmf = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm()).apply { init(ks, CharArray(0)) }
            return SSLContext.getInstance("TLS").apply { init(kmf.keyManagers, null, null) }
        }
    }

    private val rsaKeys by lazy { KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair() }

    fun selfSigned(
        cn: String = "localhost",
        dns: List<String> = listOf("localhost"),
        ips: List<ByteArray> = listOf(byteArrayOf(127, 0, 0, 1)),
        notBefore: Date = Date(System.currentTimeMillis() - 86_400_000L),
        notAfter: Date = Date(System.currentTimeMillis() + 365L * 86_400_000L),
    ): Cert {
        val kp = rsaKeys
        val sigAlg = seq(oid(byteArrayOf(0x2a, 0x86.toByte(), 0x48, 0x86.toByte(), 0xf7.toByte(), 0x0d, 0x01, 0x01, 0x0b)), byteArrayOf(0x05, 0x00))
        val name = seq(set(seq(oid(byteArrayOf(0x55, 0x04, 0x03)), Pem.tlv(0x0c, cn.toByteArray()))))
        val validity = seq(utc(notBefore), utc(notAfter))
        val general = dns.map { Pem.tlv(0x82, it.toByteArray()) } + ips.map { Pem.tlv(0x87, it) }
        val san = seq(oid(byteArrayOf(0x55, 0x1d, 0x11)), Pem.tlv(0x04, seq(*general.toTypedArray())))
        val extensions = Pem.tlv(0xa3, seq(san))
        val tbs = seq(
            Pem.tlv(0xa0, Pem.tlv(0x02, byteArrayOf(0x02))),
            Pem.tlv(0x02, BigInteger.valueOf(System.nanoTime()).abs().toByteArray()),
            sigAlg,
            name,
            validity,
            name,
            kp.public.encoded,
            extensions,
        )
        val sig = Signature.getInstance("SHA256withRSA").apply {
            initSign(kp.private)
            update(tbs)
        }.sign()
        val der = seq(tbs, sigAlg, Pem.tlv(0x03, byteArrayOf(0) + sig))
        val cert = CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(der)) as X509Certificate
        return Cert(kp, cert)
    }

    fun pem(label: String, der: ByteArray): String =
        "-----BEGIN $label-----\n" + Base64.getMimeEncoder(64, "\n".toByteArray()).encodeToString(der) + "\n-----END $label-----\n"

    private fun seq(vararg parts: ByteArray) = Pem.tlv(0x30, parts.fold(ByteArray(0)) { a, b -> a + b })
    private fun set(vararg parts: ByteArray) = Pem.tlv(0x31, parts.fold(ByteArray(0)) { a, b -> a + b })
    private fun oid(body: ByteArray) = Pem.tlv(0x06, body)
    private fun utc(d: Date): ByteArray {
        val f = SimpleDateFormat("yyMMddHHmmss'Z'", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }
        return Pem.tlv(0x17, f.format(d).toByteArray())
    }
}
