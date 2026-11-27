/**
 * Capacitor configuration for the Mesh Client mobile apps (Android + iOS).
 * The web bundle is `mobile/dist/` (`pnpm -C mobile run build`); native projects live in
 * `mobile/android` and `mobile/ios`. Desktop (Electron) builds never read this file.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.coloradomesh.meshclient',
  appName: 'Mesh Client',
  webDir: 'dist',
  android: {
    path: 'android',
    // Radios on the LAN (Meshtastic HTTP, MeshCom EXTUDP) are reached natively; the WebView
    // itself only loads bundled assets.
    allowMixedContent: false,
    captureInput: true,
    // WebView debugging and plugin-call logging stay at Capacitor's defaults: debug builds only
    // (`loggingBehavior: 'debug'`), so release builds never log plugin results such as the
    // secure-storage key.
  },
  ios: {
    path: 'ios',
    contentInset: 'never',
    scrollEnabled: false,
    limitsNavigationsToAppBoundDomains: false,
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 0, backgroundColor: '#0f172a' },
    Keyboard: { resize: 'native' },
    // Light status-bar icons on the slate app background; the WebView draws edge to edge and
    // pads itself with env(safe-area-inset-*).
    SystemBars: { insetsHandling: 'css', style: 'DARK', initialViewportFitValueHint: 'cover' },
    LocalNotifications: { smallIcon: 'ic_stat_mesh', iconColor: '#38bdf8' },
    BluetoothLe: {
      displayStrings: {
        scanning: 'Scanning for radios…',
        cancel: 'Cancel',
        availableDevices: 'Available radios',
        noDeviceFound: 'No radio found',
      },
    },
  },
};

export default config;
