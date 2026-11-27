package org.coloradomesh.meshclient.process

import org.coloradomesh.meshclient.bridge.PluginError
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class SharedDirTest {
    private val base = Files.createTempDirectory("mesh-shared-").toFile()
    private val dir = SharedDir(File(base, "mesh-reticulum"))

    @After
    fun tearDown() {
        base.deleteRecursively()
    }

    @Test
    fun createsTheRootOnDemand() {
        assertFalse(dir.root.exists())
        dir.ensure()
        assertTrue(dir.root.isDirectory)
    }

    @Test
    fun writesAtomicallyReadsListsAndRemoves() {
        dir.write("config/config", "a = 1".toByteArray())
        dir.write("storage/identities/x", byteArrayOf(1, 2, 3))
        dir.write("config/config", "a = 2".toByteArray()) // replace
        assertArrayEquals("a = 2".toByteArray(), dir.read("config/config"))
        val all = dir.list("")
        assertEquals(listOf("config/config", "storage/identities/x"), all.map { it.path })
        assertEquals(5L, all[0].size)
        assertTrue(all[0].mtimeMs > 0)
        assertEquals(listOf("storage/identities/x"), dir.list("storage").map { it.path })
        assertEquals(listOf("config/config"), dir.list("config/config").map { it.path })
        assertTrue(dir.list("missing").isEmpty())
        // No temp files left behind.
        assertEquals(listOf("config"), File(dir.root, "config").listFiles()!!.map { it.name }.filter { it.startsWith(".") }.ifEmpty { listOf("config") })
        dir.remove("storage")
        dir.remove("storage") // missing is fine
        assertEquals(listOf("config/config"), dir.list("").map { it.path })
        dir.remove("")
        assertTrue(dir.root.isDirectory)
        assertTrue(dir.list("").isEmpty())
    }

    @Test
    fun skipsInterruptedTempFilesWhenListing() {
        dir.write("a", byteArrayOf(1))
        File(dir.root, ".a.tmp-123").writeBytes(byteArrayOf(9))
        assertEquals(listOf("a"), dir.list("").map { it.path })
    }

    @Test
    fun rejectsPathsThatEscape() {
        for (bad in listOf("../x", "a/../../x", "/etc/passwd", "C:/x", "a\\..\\..\\x")) {
            val e = assertThrows(bad, PluginError::class.java) { dir.read(bad) }
            assertTrue(e.message!!.startsWith("EPERM"))
        }
        File(base, "outside").writeText("secret")
        Files.createSymbolicLink(File(dir.ensure(), "link").toPath(), base.toPath())
        assertThrows(PluginError::class.java) { dir.read("link/outside") }
    }

    @Test
    fun missingFilesAreEnoent() {
        assertTrue(assertThrows(PluginError::class.java) { dir.read("nope") }.message!!.startsWith("ENOENT"))
        assertTrue(assertThrows(PluginError::class.java) { dir.write("", ByteArray(0)) }.message!!.startsWith("EISDIR"))
    }
}
