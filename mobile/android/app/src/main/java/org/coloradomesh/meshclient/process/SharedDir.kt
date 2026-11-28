package org.coloradomesh.meshclient.process

import org.coloradomesh.meshclient.bridge.PluginError
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.UUID

/**
 * The real directory main and the Reticulum sidecar share (`MeshProcess.getSharedDir` and the
 * `shared*` file operations). All paths are relative to [root]; absolute paths and `..` segments
 * are rejected so callers cannot escape it (pure JVM; unit-tested).
 *
 * Writes are atomic (temp file in the same directory, fsync, rename): a crash mid-write leaves
 * the previous file intact and at most a stray `.*.tmp-*` file, which [list] skips.
 */
class SharedDir(val root: File) {
    fun ensure(): File {
        if (!root.isDirectory && !root.mkdirs() && !root.isDirectory) throw PluginError("EACCES could not create ${root.path}")
        return root
    }

    /** Resolves a relative path inside [root]; '' = root. */
    fun resolve(relative: String?): File {
        val rel = (relative ?: "").replace('\\', '/')
        if (rel.startsWith("/") || Regex("^[A-Za-z]:").containsMatchIn(rel)) throw PluginError("EPERM absolute paths are not allowed: $rel")
        val parts = rel.split('/').filter { it.isNotEmpty() && it != "." }
        if (parts.any { it == ".." }) throw PluginError("EPERM path escapes the shared directory: $rel")
        val base = ensure()
        val f = parts.fold(base) { acc, p -> File(acc, p) }
        val canonRoot = base.canonicalPath
        val canon = f.canonicalPath
        if (canon != canonRoot && !canon.startsWith(canonRoot + File.separator)) throw PluginError("EPERM path escapes the shared directory: $rel")
        return f
    }

    data class Entry(val path: String, val size: Long, val mtimeMs: Long)

    fun list(relative: String?): List<Entry> {
        val start = resolve(relative)
        if (!start.exists()) return emptyList()
        val rootPath = ensure().canonicalFile
        val out = mutableListOf<Entry>()
        val files = if (start.isFile) sequenceOf(start) else start.walkTopDown().filter { it.isFile }
        for (f in files) {
            if (isTemp(f.name)) continue
            val rel = f.canonicalFile.relativeTo(rootPath).invariantSeparatorsPath
            out += Entry(rel, f.length(), f.lastModified())
        }
        return out.sortedBy { it.path }
    }

    fun read(relative: String?): ByteArray {
        val f = resolve(relative)
        if (!f.isFile) throw PluginError("ENOENT no such file or directory, open '${relative.orEmpty()}'")
        return f.readBytes()
    }

    fun write(relative: String?, bytes: ByteArray) {
        val f = resolve(relative)
        if (f.canonicalPath == ensure().canonicalPath) throw PluginError("EISDIR cannot write the shared directory itself")
        if (f.isDirectory) throw PluginError("EISDIR illegal operation on a directory, open '${relative.orEmpty()}'")
        val parent = f.parentFile ?: throw PluginError("ENOENT no parent directory")
        if (!parent.isDirectory && !parent.mkdirs() && !parent.isDirectory) throw PluginError("EACCES could not create ${parent.name}")
        val tmp = File(parent, ".${f.name}.tmp-${UUID.randomUUID()}")
        try {
            FileOutputStream(tmp).use { out ->
                out.write(bytes)
                out.flush()
                out.fd.sync()
            }
            if (!tmp.renameTo(f)) throw IOException("rename failed")
        } catch (e: IOException) {
            tmp.delete()
            throw PluginError("EIO could not write '${relative.orEmpty()}': ${e.message}", e)
        }
    }

    /** Deletes a file or tree (no error when missing). '' clears the directory but keeps it. */
    fun remove(relative: String?) {
        val f = resolve(relative)
        if (!f.exists()) return
        if (f.canonicalPath == ensure().canonicalPath) {
            f.listFiles()?.forEach { it.deleteRecursively() }
            return
        }
        if (!f.deleteRecursively()) throw PluginError("EBUSY could not remove '${relative.orEmpty()}'")
    }

    private fun isTemp(name: String) = name.startsWith(".") && name.contains(".tmp-")
}
