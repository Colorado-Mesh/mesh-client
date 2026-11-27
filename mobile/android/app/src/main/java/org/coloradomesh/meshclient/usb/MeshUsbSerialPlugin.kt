package org.coloradomesh.meshclient.usb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hoho.android.usbserial.driver.CdcAcmSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import org.coloradomesh.meshclient.bridge.Codec
import org.coloradomesh.meshclient.bridge.PluginError
import org.coloradomesh.meshclient.bridge.rejectWith
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/**
 * `MeshUsbSerial` (contract: `MeshUsbSerialPlugin` in src/mobile/native/contracts.ts): USB host
 * serial through usb-serial-for-android (CDC-ACM, CP210x, CH34x, FTDI, PL2303). Backs the
 * `navigator.serial` polyfill (src/mobile/serial/installMobileSerial.ts).
 *
 * - Reads: one SerialInputOutputManager per open port -> `data` events.
 * - Writes: a per-port single-thread executor, so writes stay ordered and resolve once written.
 * - `closed` fires once per port (with `error` on I/O failure or detach); `attached` / `detached`
 *   fire for devices that have a serial driver.
 * - DTR and RTS are asserted on open, as the Linux tty layer does for Web Serial on desktop
 *   (nRF52 / TinyUSB CDC firmware only sends once DTR is set).
 */
@CapacitorPlugin(name = "MeshUsbSerial")
class MeshUsbSerialPlugin : Plugin() {
    private lateinit var usb: UsbManager
    private val prober: UsbSerialProber = UsbSerialProber.getDefaultProber()
    private val ports = ConcurrentHashMap<String, OpenPort>()
    private val portSeq = AtomicInteger()
    private val permissionWaiters = ConcurrentHashMap<String, MutableList<PluginCall>>()
    private val attached: MutableSet<String> = ConcurrentHashMap.newKeySet()
    private val io: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "MeshUsbSerial-io").apply { isDaemon = true } }
    private var receiversRegistered = false

    private val permissionReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action != ACTION_USB_PERMISSION) return
            val device = deviceExtra(intent) ?: return
            val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false) || usb.hasPermission(device)
            permissionWaiters.remove(device.deviceName)?.forEach { it.resolve(JSObject().put("granted", granted)) }
        }
    }

    private val attachReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context, intent: Intent) {
            val device = deviceExtra(intent) ?: return
            when (intent.action) {
                UsbManager.ACTION_USB_DEVICE_ATTACHED -> onAttached(device)
                UsbManager.ACTION_USB_DEVICE_DETACHED -> onDetached(device)
            }
        }
    }

    override fun load() {
        usb = context.getSystemService(Context.USB_SERVICE) as UsbManager
        // Devices present at launch are not "attached" events.
        try {
            usb.deviceList.values.filter { driverFor(it) != null }.forEach { attached += it.deviceName }
        } catch (e: Exception) {
            Log.w(TAG, "USB host unavailable: ${e.javaClass.simpleName}")
        }
        ContextCompat.registerReceiver(context, permissionReceiver, IntentFilter(ACTION_USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED)
        val f = IntentFilter().apply {
            addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED)
            addAction(UsbManager.ACTION_USB_DEVICE_DETACHED)
        }
        // System broadcasts (sent by the system UID) reach not-exported receivers.
        ContextCompat.registerReceiver(context, attachReceiver, f, ContextCompat.RECEIVER_NOT_EXPORTED)
        receiversRegistered = true
        // Launched by the USB_DEVICE_ATTACHED intent filter: the device is already granted.
        activity?.intent?.let { handleAttachIntent(it) }
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        handleAttachIntent(intent)
    }

    override fun handleOnDestroy() {
        ports.values.toList().forEach { it.close(null) }
        if (receiversRegistered) {
            try {
                context.unregisterReceiver(permissionReceiver)
                context.unregisterReceiver(attachReceiver)
            } catch (_: IllegalArgumentException) {
                // not registered
            }
            receiversRegistered = false
        }
        io.shutdownNow()
    }

    private fun handleAttachIntent(intent: Intent) {
        if (intent.action != UsbManager.ACTION_USB_DEVICE_ATTACHED) return
        deviceExtra(intent)?.let { onAttached(it) }
    }

    private fun onAttached(device: UsbDevice) {
        if (driverFor(device) == null) return
        if (!attached.add(device.deviceName)) return
        notifyListeners("attached", JSObject().put("device", deviceJs(device)))
    }

    private fun onDetached(device: UsbDevice) {
        ports.values.filter { it.device.deviceName == device.deviceName }.forEach { it.close("The device has been lost.") }
        permissionWaiters.remove(device.deviceName)?.forEach { it.resolve(JSObject().put("granted", false)) }
        if (attached.remove(device.deviceName)) notifyListeners("detached", JSObject().put("device", deviceJs(device)))
    }

    private fun driverFor(device: UsbDevice): UsbSerialDriver? = try {
        prober.probeDevice(device) ?: if (CdcAcmSerialDriver.probe(device)) CdcAcmSerialDriver(device) else null
    } catch (_: Exception) {
        null
    }

    private fun deviceJs(d: UsbDevice): JSObject {
        val o = JSObject()
            .put("deviceId", d.deviceName)
            .put("vendorId", d.vendorId)
            .put("productId", d.productId)
        d.productName?.let { o.put("productName", it) }
        d.manufacturerName?.let { o.put("manufacturerName", it) }
        // Throws SecurityException until the app holds permission for the device (Android 10+).
        try {
            d.serialNumber?.let { o.put("serialNumber", it) }
        } catch (_: SecurityException) {
            // omitted before permission
        }
        return o
    }

    private fun findDevice(deviceId: String?): UsbDevice =
        usb.deviceList.values.firstOrNull { it.deviceName == deviceId } ?: throw PluginError("NotFoundError USB device $deviceId is not connected")

    @PluginMethod
    fun listDevices(call: PluginCall) {
        val arr = JSArray()
        usb.deviceList.values.filter { driverFor(it) != null }.forEach { arr.put(deviceJs(it)) }
        call.resolve(JSObject().put("devices", arr))
    }

    @PluginMethod
    fun requestPermission(call: PluginCall) {
        val device = try {
            findDevice(call.getString("deviceId"))
        } catch (e: PluginError) {
            return call.rejectWith(e)
        }
        if (usb.hasPermission(device)) return call.resolve(JSObject().put("granted", true))
        val waiters = permissionWaiters.getOrPut(device.deviceName) { mutableListOf() }
        val first = synchronized(waiters) {
            waiters += call
            waiters.size == 1
        }
        if (!first) return
        val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
        // FLAG_MUTABLE: UsbManager fills in EXTRA_DEVICE / EXTRA_PERMISSION_GRANTED (explicit intent,
        // so the mutable PendingIntent is allowed on Android 14+).
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
        val pi = PendingIntent.getBroadcast(context, device.deviceId, intent, flags)
        try {
            usb.requestPermission(device, pi)
        } catch (e: Exception) {
            permissionWaiters.remove(device.deviceName)?.forEach { it.reject("SecurityError ${e.message ?: e.javaClass.simpleName}") }
        }
    }

    @PluginMethod
    fun open(call: PluginCall) {
        io.execute {
            try {
                val device = findDevice(call.getString("deviceId"))
                if (!usb.hasPermission(device)) throw PluginError("SecurityError USB permission not granted")
                val line = UsbParams.line(call.getInt("baudRate"), call.getInt("dataBits"), call.getInt("stopBits"), call.getString("parity"))
                val driver = driverFor(device) ?: throw PluginError("NotFoundError no serial driver for this device")
                val port = driver.ports.firstOrNull() ?: throw PluginError("NotFoundError the device has no serial ports")
                val connection = usb.openDevice(device) ?: throw PluginError("NetworkError could not open the USB device")
                try {
                    port.open(connection)
                    port.setParameters(line.baudRate, line.dataBits, line.stopBits, line.parity)
                    try {
                        port.dtr = true
                        port.rts = true
                    } catch (_: UnsupportedOperationException) {
                        // driver without control lines
                    }
                } catch (e: Exception) {
                    try {
                        port.close()
                    } catch (_: IOException) {
                        // ignore
                    }
                    connection.close()
                    throw PluginError("NetworkError Failed to open serial port: ${e.message ?: e.javaClass.simpleName}", e)
                }
                val portId = "usb${portSeq.incrementAndGet()}"
                val p = OpenPort(portId, device, port)
                ports[portId] = p
                call.resolve(JSObject().put("portId", portId))
                p.start()
            } catch (e: Exception) {
                call.rejectWith(e)
            }
        }
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val p = ports[call.getString("portId")] ?: return call.reject("InvalidStateError The port is closed.")
        p.write(Codec.unb64(call.getString("dataB64"))) { err -> if (err == null) call.resolve() else call.rejectWith(err) }
    }

    @PluginMethod
    fun close(call: PluginCall) {
        ports[call.getString("portId")]?.close(null)
        call.resolve()
    }

    @PluginMethod
    fun setSignals(call: PluginCall) {
        val p = ports[call.getString("portId")] ?: return call.reject("InvalidStateError The port is closed.")
        p.control(call) {
            call.getBoolean("dtr")?.let { p.port.dtr = it }
            call.getBoolean("rts")?.let { p.port.rts = it }
            call.getBoolean("brk")?.let { p.port.setBreak(it) }
            call.resolve()
        }
    }

    @PluginMethod
    fun getSignals(call: PluginCall) {
        val p = ports[call.getString("portId")] ?: return call.reject("InvalidStateError The port is closed.")
        p.control(call) {
            fun line(read: () -> Boolean): Boolean = try {
                read()
            } catch (_: UnsupportedOperationException) {
                false
            }
            call.resolve(
                JSObject()
                    .put("dcd", line { p.port.cd })
                    .put("cts", line { p.port.cts })
                    .put("ri", line { p.port.ri })
                    .put("dsr", line { p.port.dsr }),
            )
        }
    }

    private inner class OpenPort(val portId: String, val device: UsbDevice, val port: UsbSerialPort) : SerialInputOutputManager.Listener {
        private val manager = SerialInputOutputManager(port, this)
        private val writer = Executors.newSingleThreadExecutor { r -> Thread(r, "MeshUsbSerial-write").apply { isDaemon = true } }
        private val closed = AtomicBoolean(false)

        fun start() {
            manager.readBufferSize = maxOf(port.readEndpoint?.maxPacketSize ?: 64, 4096)
            manager.start()
        }

        override fun onNewData(data: ByteArray) {
            if (!closed.get()) notifyListeners("data", JSObject().put("portId", portId).put("dataB64", Codec.b64(data)))
        }

        override fun onRunError(e: Exception) {
            close("NetworkError ${e.message ?: e.javaClass.simpleName}")
        }

        fun write(bytes: ByteArray, done: (Throwable?) -> Unit) {
            try {
                writer.execute {
                    if (closed.get()) return@execute done(PluginError("InvalidStateError The port is closed."))
                    try {
                        port.write(bytes, WRITE_TIMEOUT_MS)
                        done(null)
                    } catch (e: IOException) {
                        done(PluginError("NetworkError ${e.message ?: "write failed"}", e))
                        close("NetworkError ${e.message ?: "write failed"}")
                    }
                }
            } catch (_: RejectedExecutionException) {
                done(PluginError("InvalidStateError The port is closed."))
            }
        }

        fun control(call: PluginCall, block: () -> Unit) {
            try {
                writer.execute {
                    try {
                        block()
                    } catch (e: Exception) {
                        call.reject("NetworkError ${e.message ?: e.javaClass.simpleName}")
                    }
                }
            } catch (_: RejectedExecutionException) {
                call.reject("InvalidStateError The port is closed.")
            }
        }

        fun close(error: String?) {
            if (!closed.compareAndSet(false, true)) return
            ports.remove(portId, this)
            manager.listener = null
            try {
                manager.stop()
            } catch (_: Exception) {
                // already stopped
            }
            writer.shutdown()
            try {
                port.close()
            } catch (_: IOException) {
                // already closed (device gone)
            }
            val ev = JSObject().put("portId", portId)
            if (error != null) ev.put("error", error)
            notifyListeners("closed", ev)
        }
    }

    companion object {
        private const val TAG = "MeshUsbSerial"
        private const val ACTION_USB_PERMISSION = "org.coloradomesh.meshclient.USB_PERMISSION"
        private const val WRITE_TIMEOUT_MS = 2_000

        @Suppress("DEPRECATION")
        private fun deviceExtra(intent: Intent): UsbDevice? =
            if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java) else intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
    }
}
