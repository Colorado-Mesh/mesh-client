// Loads the unmodified Electron preload in the mobile WebView (its `electron` import is aliased
// to mobile/src/bridge/electronRenderer.ts by mobile/vite.config.mts). Kept as a plain JS module
// with a declaration file so the renderer's TypeScript program does not pull in Electron typings.
import '@/preload/index';
