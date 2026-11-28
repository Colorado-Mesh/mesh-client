package org.coloradomesh.meshclient.bridge

import kotlin.io.encoding.Base64

/**
 * Binary <-> text helpers for the plugin contract (`src/mobile/native/contracts.ts`): payloads
 * cross the bridge as base64, the safeStorage key as lower-case hex. Pure Kotlin so it runs on
 * API 24 (java.util.Base64 is API 26) and in JVM unit tests (android.util.Base64 is a stub there).
 */
object Codec {
    /** Lenient decoder: padding optional, like Node `Buffer.from(s, 'base64')`. */
    private val decoder = Base64.Default.withPadding(Base64.PaddingOption.PRESENT_OPTIONAL)
    private val whitespace = Regex("\\s+")
    private val hexDigits = "0123456789abcdef".toCharArray()

    fun b64(bytes: ByteArray, offset: Int = 0, length: Int = bytes.size - offset): String =
        Base64.Default.encode(bytes, offset, offset + length)

    /** Decodes base64 (standard or URL-safe alphabet, whitespace ignored); null/empty -> empty. */
    fun unb64(s: String?): ByteArray {
        if (s.isNullOrEmpty()) return ByteArray(0)
        val clean = s.replace(whitespace, "").replace('-', '+').replace('_', '/')
        return decoder.decode(clean)
    }

    fun hex(bytes: ByteArray): String {
        val out = CharArray(bytes.size * 2)
        for (i in bytes.indices) {
            val v = bytes[i].toInt() and 0xff
            out[i * 2] = hexDigits[v ushr 4]
            out[i * 2 + 1] = hexDigits[v and 0x0f]
        }
        return String(out)
    }
}
