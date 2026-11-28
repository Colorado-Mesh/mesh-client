package org.coloradomesh.meshclient

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import org.coloradomesh.meshclient.device.MeshDevicePlugin
import org.coloradomesh.meshclient.net.MeshNetPlugin
import org.coloradomesh.meshclient.process.MeshProcessPlugin
import org.coloradomesh.meshclient.usb.MeshUsbSerialPlugin

/**
 * Capacitor host activity. The four Mesh Client plugins are app-local (not npm packages), so they
 * are registered here before `super.onCreate` builds the bridge. `configChanges` in the manifest
 * keeps this activity (and the WebView + host worker) alive across fold / unfold and resizes.
 */
class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(MeshNetPlugin::class.java)
        registerPlugin(MeshDevicePlugin::class.java)
        registerPlugin(MeshUsbSerialPlugin::class.java)
        registerPlugin(MeshProcessPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
