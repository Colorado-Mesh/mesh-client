package org.coloradomesh.meshclient.net

import org.coloradomesh.meshclient.bridge.PluginError
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.security.AlgorithmParameters
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.spec.ECGenParameterSpec
import javax.crypto.Cipher
import javax.crypto.EncryptedPrivateKeyInfo
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.PBEParameterSpec
import java.io.ByteArrayOutputStream

class PemTest {
    private val rsa = TestCerts.selfSigned()

    @Test
    fun readsPkcs8RsaKeys() {
        val key = Pem.privateKey(rsa.keyPkcs8Pem.toByteArray(), null)
        assertArrayEquals(rsa.keyPair.private.encoded, key.encoded)
    }

    @Test
    fun readsDerPkcs8Keys() {
        assertArrayEquals(rsa.keyPair.private.encoded, Pem.privateKey(rsa.keyPair.private.encoded, null).encoded)
    }

    @Test
    fun wrapsPkcs1RsaKeysAsNodeForgeWritesThem() {
        val pkcs8 = rsa.keyPair.private.encoded
        val outer = Pem.readTlv(pkcs8, 0)
        val octet = Pem.children(pkcs8, outer)[2]
        val pkcs1 = pkcs8.copyOfRange(octet.start, octet.end)
        val pem = TestCerts.pem("RSA PRIVATE KEY", pkcs1)
        assertArrayEquals(pkcs8, Pem.privateKey(pem.toByteArray(), null).encoded)
    }

    @Test
    fun wrapsSec1EcKeys() {
        val kp = KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
        val pkcs8 = kp.private.encoded
        // Build a SEC1 ECPrivateKey with [0] namedCurve parameters, as `openssl ecparam -genkey` writes.
        val outer = Pem.readTlv(pkcs8, 0)
        val parts = Pem.children(pkcs8, outer)
        val curveOid = Pem.children(pkcs8, parts[1])[1]
        val inner = Pem.readTlv(pkcs8, parts[2].start)
        val innerParts = Pem.children(pkcs8, inner)
        val d = innerParts[1]
        val sec1 = Pem.tlv(
            0x30,
            byteArrayOf(0x02, 0x01, 0x01) + pkcs8.copyOfRange(d.headerStart, d.end) +
                Pem.tlv(0xa0, pkcs8.copyOfRange(curveOid.headerStart, curveOid.end)),
        )
        val key = Pem.privateKey(TestCerts.pem("EC PRIVATE KEY", sec1).toByteArray(), null) as ECPrivateKey
        assertEquals((kp.private as ECPrivateKey).s, key.s)
    }

    @Test
    fun decryptsEncryptedPkcs8WithThePassphrase() {
        // PBES1 (PKCS#12 PBE) here; OpenSSL's default PBES2 depends on the platform's JCE names.
        val alg = "PBEWithSHA1AndDESede"
        val params = PBEParameterSpec(ByteArray(8).also { SecureRandom().nextBytes(it) }, 2048)
        val key = SecretKeyFactory.getInstance(alg).generateSecret(PBEKeySpec("secret".toCharArray()))
        val enc = Cipher.getInstance(alg).apply { init(Cipher.ENCRYPT_MODE, key, params) }.doFinal(rsa.keyPair.private.encoded)
        val ap = AlgorithmParameters.getInstance(alg).apply { init(params) }
        val pem = TestCerts.pem("ENCRYPTED PRIVATE KEY", EncryptedPrivateKeyInfo(ap, enc).encoded)
        assertArrayEquals(rsa.keyPair.private.encoded, Pem.privateKey(pem.toByteArray(), "secret").encoded)
        val noPass = assertThrows(PluginError::class.java) { Pem.privateKey(pem.toByteArray(), null) }
        assertEquals(true, noPass.message!!.startsWith("ERR_OSSL_BAD_DECRYPT"))
        assertThrows(PluginError::class.java) { Pem.privateKey(pem.toByteArray(), "wrong") }
    }

    @Test
    fun rejectsLegacyEncryptedPem() {
        val legacy = "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n-----END RSA PRIVATE KEY-----\n"
        val e = assertThrows(PluginError::class.java) { Pem.privateKey(legacy.toByteArray(), "x") }
        assertEquals(true, e.message!!.startsWith("ERR_OSSL_UNSUPPORTED"))
    }

    @Test
    fun readsCertificateBundlesInPemAndDer() {
        val other = TestCerts.selfSigned(cn = "other", dns = listOf("other"))
        val bundle = (rsa.certPem + "junk between blocks\n" + other.certPem).toByteArray()
        assertEquals(listOf(rsa.cert, other.cert), Pem.certificates(bundle))
        assertEquals(listOf(rsa.cert), Pem.certificates(rsa.cert.encoded))
    }

    @Test
    fun buildsKeyManagersFromPemOrPkcs12() {
        val pem = TlsMaterial(cert = rsa.certPem.toByteArray(), key = rsa.keyPkcs8Pem.toByteArray())
        assertEquals(1, TlsSupport.keyManagers(pem)!!.size)
        val ks = KeyStore.getInstance("PKCS12").apply {
            load(null, null)
            setKeyEntry("k", rsa.keyPair.private, "pw".toCharArray(), arrayOf(rsa.cert))
        }
        val p12 = ByteArrayOutputStream().also { ks.store(it, "pw".toCharArray()) }.toByteArray()
        assertEquals(1, TlsSupport.keyManagers(TlsMaterial(pfx = p12, passphrase = "pw"))!!.size)
        val bad = assertThrows(PluginError::class.java) { TlsSupport.keyManagers(TlsMaterial(pfx = p12, passphrase = "nope")) }
        assertEquals(true, bad.message!!.startsWith("ERR_CRYPTO_PKCS12"))
        assertEquals(null, TlsSupport.keyManagers(TlsMaterial()))
    }
}
