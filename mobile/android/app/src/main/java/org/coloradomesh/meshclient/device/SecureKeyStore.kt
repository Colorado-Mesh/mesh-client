package org.coloradomesh.meshclient.device

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import org.coloradomesh.meshclient.bridge.Codec
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * The 32-byte safeStorage key (`MeshDevice.getSecureKey`): generated once with SecureRandom,
 * encrypted with an AES-256/GCM key that lives in AndroidKeyStore (hardware-backed where the
 * device has a TEE/StrongBox), ciphertext + IV kept in private SharedPreferences.
 *
 * Failure handling: if the stored ciphertext cannot be decrypted (Keystore key lost, e.g. after a
 * device credential reset), a new key is generated and the old ciphertext is replaced; anything
 * main encrypted with the previous key becomes unreadable, which main already treats as
 * "re-enter secret". The failure is logged (no key material).
 */
class SecureKeyStore(private val context: Context) {
    private val prefs by lazy { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    @Synchronized
    fun getOrCreateKeyHex(): String {
        val stored = prefs.getString(PREF_CIPHERTEXT, null)
        if (stored != null) {
            try {
                val blob = Codec.unb64(stored)
                val key = decrypt(blob)
                if (key.size == KEY_BYTES) return Codec.hex(key)
                Log.w(TAG, "stored safeStorage key has the wrong length; regenerating")
            } catch (e: Exception) {
                Log.w(TAG, "could not unwrap the safeStorage key (${e.javaClass.simpleName}); regenerating")
            }
        }
        val fresh = ByteArray(KEY_BYTES).also { SecureRandom().nextBytes(it) }
        val blob = encrypt(fresh)
        if (!prefs.edit().putString(PREF_CIPHERTEXT, Codec.b64(blob)).commit()) {
            throw IllegalStateException("could not persist the safeStorage key")
        }
        return Codec.hex(fresh)
    }

    private fun wrappingKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return gen.generateKey()
    }

    /** Blob layout: [ivLen:1][iv][ciphertext+tag]. */
    private fun encrypt(plain: ByteArray): ByteArray {
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(plain)
        return byteArrayOf(iv.size.toByte()) + iv + ct
    }

    private fun decrypt(blob: ByteArray): ByteArray {
        val ivLen = blob[0].toInt() and 0xff
        require(ivLen in 12..16 && blob.size > 1 + ivLen) { "malformed key blob" }
        val iv = blob.copyOfRange(1, 1 + ivLen)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, iv))
        return cipher.doFinal(blob, 1 + ivLen, blob.size - 1 - ivLen)
    }

    companion object {
        private const val TAG = "MeshDevice"
        private const val ANDROID_KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "mesh_client_safe_storage_wrap_v1"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val PREFS = "mesh_device_secure"
        private const val PREF_CIPHERTEXT = "safe_storage_key_v1"
        private const val KEY_BYTES = 32
    }
}
