/**
 * Replaces `mqtt/build/lib/is-browser.js` in the mobile host bundle. The worker is not a browser
 * for mqtt.js purposes: brokers are reached over raw TCP/TLS (`mqtt://`, `mqtts://`) through the
 * native socket shims, exactly like the desktop main process.
 */
export const isWebWorker = false;
export const isReactNativeBrowser = false;
export default false;
