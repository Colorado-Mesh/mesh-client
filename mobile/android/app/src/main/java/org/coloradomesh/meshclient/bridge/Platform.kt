package org.coloradomesh.meshclient.bridge

import android.os.Build

/**
 * API-level checks that also work in JVM unit tests (where `Build.VERSION.SDK_INT` is a stub
 * returning 0 but every Java API is available).
 */
object Platform {
    val onAndroid: Boolean = System.getProperty("java.vm.name") == "Dalvik"

    fun atLeast(sdk: Int): Boolean = !onAndroid || Build.VERSION.SDK_INT >= sdk
}
