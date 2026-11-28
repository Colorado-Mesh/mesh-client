package org.coloradomesh.meshclient.bridge

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Test

class CodecTest {
    @Test
    fun base64RoundTripsBinary() {
        val bytes = ByteArray(256) { it.toByte() }
        assertArrayEquals(bytes, Codec.unb64(Codec.b64(bytes)))
    }

    @Test
    fun base64EncodesASlice() {
        val bytes = "xxhelloyy".toByteArray()
        assertEquals("aGVsbG8=", Codec.b64(bytes, 2, 5))
    }

    @Test
    fun base64DecodingIsLenientLikeNodeBuffer() {
        assertArrayEquals("hello".toByteArray(), Codec.unb64("aGVsbG8"))
        assertArrayEquals("hello".toByteArray(), Codec.unb64("aGVs\nbG8=\n"))
        assertArrayEquals(byteArrayOf(-5, -1), Codec.unb64("-_8")) // URL-safe alphabet
        assertArrayEquals(ByteArray(0), Codec.unb64(null))
        assertArrayEquals(ByteArray(0), Codec.unb64(""))
    }

    @Test
    fun hexIsLowerCaseAndPadded() {
        assertEquals("000fa0ff", Codec.hex(byteArrayOf(0, 15, -96, -1)))
        assertEquals(64, Codec.hex(ByteArray(32)).length)
    }
}
