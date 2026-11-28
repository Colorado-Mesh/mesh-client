package org.coloradomesh.meshclient.device

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import org.coloradomesh.meshclient.MainActivity
import org.coloradomesh.meshclient.R

/**
 * `connectedDevice` foreground service behind `MeshDevice.setBackgroundMode`: an ongoing,
 * low-importance notification plus a partial wake lock so the WebView, the host worker and its
 * radio links (TCP/UDP sockets, BLE, USB serial, the Reticulum sidecar) keep running while the app
 * is in the background. Not sticky: if the process dies there is no WebView to serve.
 *
 * Android 14+: the connectedDevice type needs one of its prerequisite permissions; the manifest's
 * CHANGE_WIFI_MULTICAST_STATE (normal, install-time) satisfies it without runtime grants.
 */
class MeshForegroundService : Service() {
    private var wakeLock: PowerManager.WakeLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() } ?: getString(R.string.background_notification_title)
        val text = intent?.getStringExtra(EXTRA_TEXT)?.takeIf { it.isNotBlank() } ?: getString(R.string.background_notification_text)
        ensureChannel(this)
        val notification = buildNotification(title, text)
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type)
        } catch (e: Exception) {
            Log.e(TAG, "startForeground failed: ${e.javaClass.simpleName}: ${e.message}")
            stopSelf()
            return START_NOT_STICKY
        }
        acquireWakeLock()
        return START_NOT_STICKY
    }

    /** Swiped away from recents: the WebView goes with the task, so stop holding the device awake. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wakeLock = null
        super.onDestroy()
    }

    @SuppressLint("WakelockTimeout") // Held exactly while background mode is on; released in onDestroy.
    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "MeshClient:background").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun buildNotification(title: String, text: String): Notification {
        val open = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
        val pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_mesh)
            .setColor(ContextCompat.getColor(this, R.color.mesh_accent))
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(pi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()
    }

    companion object {
        private const val TAG = "MeshDevice"
        const val EXTRA_TITLE = "title"
        const val EXTRA_TEXT = "text"
        private const val CHANNEL_ID = "mesh_background"
        private const val NOTIFICATION_ID = 4711

        fun ensureChannel(ctx: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val nm = ctx.getSystemService(NotificationManager::class.java) ?: return
            if (nm.getNotificationChannel(CHANNEL_ID) != null) return
            val ch = NotificationChannel(CHANNEL_ID, ctx.getString(R.string.background_channel_name), NotificationManager.IMPORTANCE_LOW)
            ch.description = ctx.getString(R.string.background_channel_description)
            ch.setShowBadge(false)
            nm.createNotificationChannel(ch)
        }
    }
}
