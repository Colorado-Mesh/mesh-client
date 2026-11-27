/**
 * Capacitor configuration for the Mesh Client mobile apps (Android + iOS).
 * The web bundle is `dist-mobile/` (`pnpm run mobile:build`); native projects live in
 * `mobile/android` and `mobile/ios`. Desktop (Electron) builds never read this file.
 */
import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.coloradomesh.meshclient',
  appName: 'Mesh Client',
  webDir: 'dist-mobile',
  android: {
    path: 'mobile/android',
    // Radios on the LAN (Meshtastic HTTP, MeshCom EXTUDP) are reached natively; the WebView
    // itself only loads bundled assets.
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: true,
  },
  ios: {
    path: 'mobile/ios',
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
    Keyboard: { resize: 'native', resizeOnFullScreen: true },
    SystemBars: { insetsHandling: 'css' },
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
