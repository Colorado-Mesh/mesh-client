package org.coloradomesh.meshclient.device

import android.content.Intent
import android.os.Build
import android.util.Log
import android.view.View
import android.view.WindowManager
import androidx.core.content.ContextCompat
import androidx.core.util.Consumer
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker
import androidx.window.layout.WindowLayoutInfo
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import org.coloradomesh.meshclient.bridge.JsConvert
import java.io.File
import java.util.Locale
import java.util.concurrent.Executors

/**
 * `MeshDevice` (contract: `MeshDevicePlugin` in src/mobile/native/contracts.ts): safeStorage key,
 * app info, fold posture (Jetpack WindowManager) + `foldChanged` events, keep-awake, and the
 * background-mode foreground service.
 */
@CapacitorPlugin(name = "MeshDevice")
class MeshDevicePlugin : Plugin() {
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "MeshDevice-io").apply { isDaemon = true } }
    private val keyStore by lazy { SecureKeyStore(context) }

    private var tracker: WindowInfoTrackerCallbackAdapter? = null
    private var lastLayout: WindowLayoutInfo? = null

    /** Latest folds (main thread writes, any thread reads). */
    @Volatile
    private var folds: List<CssFold> = emptyList()
    private var foldsPublished = false

    private val layoutConsumer = Consumer<WindowLayoutInfo> { info ->
        lastLayout = info
        recomputeFolds()
    }

    /** The WebView moves inside the window when system-bar padding changes; fold coords follow. */
    private val webViewLayoutListener = View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, orr, ob ->
        if (l != ol || t != ot || r != orr || b != ob) recomputeFolds()
    }

    override fun load() {
        // Plugins load on the main thread during BridgeActivity.onCreate.
        try {
            val adapter = WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(activity))
            adapter.addWindowLayoutInfoListener(activity, ContextCompat.getMainExecutor(activity), layoutConsumer)
            tracker = adapter
        } catch (e: Throwable) {
            Log.w(TAG, "WindowInfoTracker unavailable: ${e.javaClass.simpleName}")
        }
        bridge.webView?.addOnLayoutChangeListener(webViewLayoutListener)
    }

    override fun handleOnDestroy() {
        // The service only exists to keep this activity's WebView + host worker alive; without
        // them it would hold a wake lock and an ongoing notification for nothing. A recreated
        // activity re-enables it once its links are live again (backgroundKeeper starts disabled).
        context.stopService(Intent(context, MeshForegroundService::class.java))
        tracker?.removeWindowLayoutInfoListener(layoutConsumer)
        tracker = null
        bridge.webView?.removeOnLayoutChangeListener(webViewLayoutListener)
        io.shutdown()
    }

    /** Main thread. Emits `foldChanged` when the CSS-space folds differ from the last report. */
    private fun recomputeFolds() {
        val info = lastLayout ?: return
        val webView = bridge.webView ?: return
        val loc = IntArray(2)
        webView.getLocationInWindow(loc)
        val density = activity.resources.displayMetrics.density
        val next = info.displayFeatures.filterIsInstance<FoldingFeature>().map { f ->
            val b = f.bounds
            FoldGeometry.toCss(
                boundsLeft = b.left,
                boundsTop = b.top,
                boundsRight = b.right,
                boundsBottom = b.bottom,
                webViewX = loc[0],
                webViewY = loc[1],
                density = density,
                vertical = f.orientation == FoldingFeature.Orientation.VERTICAL,
                halfOpened = f.state == FoldingFeature.State.HALF_OPENED,
                separating = f.isSeparating,
            )
        }
        if (foldsPublished && next == folds) return
        folds = next
        foldsPublished = true
        Log.d(TAG, "foldChanged ${next.size} fold(s) ${next.joinToString { "${it.orientation}/${it.state}" }}")
        notifyListeners("foldChanged", foldsJs(next))
    }

    private fun foldsJs(list: List<CssFold>): JSObject = JSObject().put("folds", JSArray().also { a -> list.forEach { a.put(JsConvert.obj(it.toMap())) } })

    @PluginMethod
    fun getSecureKey(call: PluginCall) {
        io.execute {
            try {
                call.resolve(JSObject().put("keyHex", keyStore.getOrCreateKeyHex()))
            } catch (e: Exception) {
                Log.e(TAG, "getSecureKey failed: ${e.javaClass.simpleName}")
                call.reject("Secure key unavailable: ${e.javaClass.simpleName}")
            }
        }
    }

    @PluginMethod
    fun getInfo(call: PluginCall) {
        val ctx = context
        val versionName = try {
            @Suppress("DEPRECATION")
            ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName ?: "0.0.0"
        } catch (e: Exception) {
            "0.0.0"
        }
        val sidecar = File(ctx.applicationInfo.nativeLibraryDir, SIDECAR_LIBRARY)
        val info = JSObject()
            .put("appVersion", versionName)
            .put("sidecarAvailable", sidecar.isFile)
            .put("locale", Locale.getDefault().toLanguageTag())
            .put("model", listOf(Build.MANUFACTURER, Build.MODEL).filter { !it.isNullOrBlank() }.joinToString(" "))
            .put("osVersion", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
        call.resolve(info)
    }

    @PluginMethod
    fun getFoldState(call: PluginCall) {
        bridge.executeOnMainThread {
            recomputeFolds()
            call.resolve(foldsJs(folds))
        }
    }

    @PluginMethod
    fun keepAwake(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) == true
        bridge.executeOnMainThread {
            val w = activity.window
            if (enabled) w.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) else w.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }

    @PluginMethod
    fun setBackgroundMode(call: PluginCall) {
        val enabled = call.getBoolean("enabled", false) == true
        val ctx = context
        val intent = Intent(ctx, MeshForegroundService::class.java)
        if (!enabled) {
            ctx.stopService(intent)
            call.resolve()
            return
        }
        intent.putExtra(MeshForegroundService.EXTRA_TITLE, call.getString("title"))
        intent.putExtra(MeshForegroundService.EXTRA_TEXT, call.getString("text"))
        try {
            ContextCompat.startForegroundService(ctx, intent)
            call.resolve()
        } catch (e: Exception) {
            // Android 12+: ForegroundServiceStartNotAllowedException when the app is already in the
            // background. Enable background mode while the app is visible (e.g. on connect).
            Log.w(TAG, "background mode not started: ${e.javaClass.simpleName}")
            call.reject("EPERM background mode could not start: ${e.message ?: e.javaClass.simpleName}")
        }
    }

    companion object {
        private const val TAG = "MeshDevice"
        const val SIDECAR_LIBRARY = "libmesh_client_reticulum.so"
    }
}
