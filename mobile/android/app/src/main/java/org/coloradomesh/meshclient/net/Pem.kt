package org.coloradomesh.meshclient.net

import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.PluginError
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.KeyFactory
import java.security.PrivateKey
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.EncryptedPrivateKeyInfo
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec

/**
 * PEM / DER credential parsing for MeshNet TLS (TAK mutual TLS, local TLS servers, custom CAs).
 * Private keys: PKCS#8 (`PRIVATE KEY`), PKCS#1 RSA (`RSA PRIVATE KEY`, what node-forge writes),
 * SEC1 EC (`EC PRIVATE KEY`) and encrypted PKCS#8 (`ENCRYPTED PRIVATE KEY` + passphrase).
 * Legacy OpenSSL-encrypted PEM (`Proc-Type: 4,ENCRYPTED`) is not supported.
 */
object Pem {
    data class Block(val label: String, val der: ByteArray)

    private val blockRe = Regex("-----BEGIN ([A-Z0-9 ]+)-----([\\s\\S]*?)-----END \\1-----")

    fun isPem(bytes: ByteArray): Boolean = String(bytes, Charsets.ISO_8859_1).contains("-----BEGIN ")

    fun blocks(text: String): List<Block> = blockRe.findAll(text).map { m ->
        val body = m.groupValues[2].lines().filter { it.isNotBlank() && !it.contains(':') }.joinToString("")
        if (m.groupValues[2].contains("Proc-Type:")) throw PluginError("ERR_OSSL_UNSUPPORTED legacy encrypted PEM keys are not supported; use PKCS#8")
        Block(m.groupValues[1], Codec.unb64(body))
    }.toList()

    /** Certificates from PEM (any number of blocks) or a single DER certificate. */
    fun certificates(bytes: ByteArray): List<X509Certificate> {
        val cf = CertificateFactory.getInstance("X.509")
        if (isPem(bytes)) {
            return blocks(String(bytes, Charsets.ISO_8859_1))
                .filter { it.label == "CERTIFICATE" || it.label == "TRUSTED CERTIFICATE" || it.label == "X509 CERTIFICATE" }
                .map { cf.generateCertificate(ByteArrayInputStream(it.der)) as X509Certificate }
        }
        return cf.generateCertificates(ByteArrayInputStream(bytes)).map { it as X509Certificate }
    }

    fun privateKey(bytes: ByteArray, passphrase: String?): PrivateKey {
        if (!isPem(bytes)) return pkcs8(bytes)
        val block = blocks(String(bytes, Charsets.ISO_8859_1)).firstOrNull { it.label.endsWith("PRIVATE KEY") }
            ?: throw PluginError("ERR_OSSL_UNSUPPORTED no private key found")
        return when (block.label) {
            "PRIVATE KEY" -> pkcs8(block.der)
            "RSA PRIVATE KEY" -> pkcs8(rsaPkcs1ToPkcs8(block.der))
            "EC PRIVATE KEY" -> pkcs8(sec1ToPkcs8(block.der))
            "ENCRYPTED PRIVATE KEY" -> pkcs8(decryptPkcs8(block.der, passphrase))
            else -> throw PluginError("ERR_OSSL_UNSUPPORTED unsupported private key type ${block.label}")
        }
    }

    private fun pkcs8(der: ByteArray): PrivateKey {
        val algorithm = when (pkcs8AlgorithmOid(der)) {
            OID_RSA -> "RSA"
            OID_EC -> "EC"
            OID_ED25519 -> "Ed25519"
            else -> null
        }
        val spec = PKCS8EncodedKeySpec(der)
        val candidates = listOfNotNull(algorithm) + listOf("RSA", "EC")
        for (alg in candidates.distinct()) {
            try {
                return KeyFactory.getInstance(alg).generatePrivate(spec)
            } catch (_: Exception) {
                // try the next algorithm
            }
        }
        throw PluginError("ERR_OSSL_UNSUPPORTED unsupported private key")
    }

    private fun decryptPkcs8(der: ByteArray, passphrase: String?): ByteArray {
        if (passphrase.isNullOrEmpty()) throw PluginError("ERR_OSSL_BAD_DECRYPT the private key is encrypted; a passphrase is required")
        try {
            val epki = EncryptedPrivateKeyInfo(der)
            val skf = SecretKeyFactory.getInstance(epki.algName)
            val key = skf.generateSecret(PBEKeySpec(passphrase.toCharArray()))
            val cipher = Cipher.getInstance(epki.algName)
            cipher.init(Cipher.DECRYPT_MODE, key, epki.algParameters)
            return epki.getKeySpec(cipher).encoded
        } catch (e: Exception) {
            throw PluginError("ERR_OSSL_BAD_DECRYPT could not decrypt the private key", e)
        }
    }

    // ── Minimal DER ──────────────────────────────────────────────────────────

    private val OID_RSA = byteArrayOf(0x2a, 0x86.toByte(), 0x48, 0x86.toByte(), 0xf7.toByte(), 0x0d, 0x01, 0x01, 0x01).toList()
    private val OID_EC = byteArrayOf(0x2a, 0x86.toByte(), 0x48, 0xce.toByte(), 0x3d, 0x02, 0x01).toList()
    private val OID_ED25519 = byteArrayOf(0x2b, 0x65, 0x70).toList()

    internal class Tlv(val tag: Int, val start: Int, val length: Int, val headerStart: Int) {
        val end get() = start + length
    }

    internal fun readTlv(b: ByteArray, offset: Int): Tlv {
        require(offset + 2 <= b.size) { "truncated DER" }
        val tag = b[offset].toInt() and 0xff
        var len = b[offset + 1].toInt() and 0xff
        var p = offset + 2
        if (len and 0x80 != 0) {
            val n = len and 0x7f
            require(n in 1..4 && p + n <= b.size) { "bad DER length" }
            len = 0
            repeat(n) { len = (len shl 8) or (b[p++].toInt() and 0xff) }
        }
        require(len >= 0 && p + len <= b.size) { "truncated DER" }
        return Tlv(tag, p, len, offset)
    }

    internal fun children(b: ByteArray, parent: Tlv): List<Tlv> {
        val out = mutableListOf<Tlv>()
        var p = parent.start
        while (p < parent.end) {
            val t = readTlv(b, p)
            out += t
            p = t.end
        }
        return out
    }

    internal fun tlv(tag: Int, content: ByteArray): ByteArray {
        val out = ByteArrayOutputStream()
        out.write(tag)
        val n = content.size
        when {
            n < 0x80 -> out.write(n)
            n <= 0xff -> { out.write(0x81); out.write(n) }
            n <= 0xffff -> { out.write(0x82); out.write(n ushr 8); out.write(n and 0xff) }
            else -> { out.write(0x83); out.write(n ushr 16); out.write((n ushr 8) and 0xff); out.write(n and 0xff) }
        }
        out.write(content)
        return out.toByteArray()
    }

    private fun pkcs8AlgorithmOid(der: ByteArray): List<Byte>? = try {
        val seq = readTlv(der, 0)
        val algId = children(der, seq)[1]
        val oid = children(der, algId)[0]
        der.copyOfRange(oid.start, oid.end).toList()
    } catch (_: Exception) {
        null
    }

    /** PKCS#1 RSAPrivateKey -> PKCS#8 PrivateKeyInfo. */
    fun rsaPkcs1ToPkcs8(pkcs1: ByteArray): ByteArray {
        val version = byteArrayOf(0x02, 0x01, 0x00)
        val algId = tlv(0x30, tlv(0x06, OID_RSA.toByteArray()) + byteArrayOf(0x05, 0x00))
        return tlv(0x30, version + algId + tlv(0x04, pkcs1))
    }

    /** SEC1 ECPrivateKey (with its `[0]` curve parameters) -> PKCS#8 PrivateKeyInfo. */
    fun sec1ToPkcs8(sec1: ByteArray): ByteArray {
        val seq = readTlv(sec1, 0)
        val params = children(sec1, seq).firstOrNull { it.tag == 0xa0 }
            ?: throw PluginError("ERR_OSSL_UNSUPPORTED EC key without curve parameters")
        val curveOid = readTlv(sec1, params.start)
        require(curveOid.tag == 0x06) { "EC key parameters are not a named curve" }
        val curve = sec1.copyOfRange(curveOid.headerStart, curveOid.end)
        val version = byteArrayOf(0x02, 0x01, 0x00)
        val algId = tlv(0x30, tlv(0x06, OID_EC.toByteArray()) + curve)
        return tlv(0x30, version + algId + tlv(0x04, sec1))
    }
}
