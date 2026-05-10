/**
 * Static About document for Windows only (GitHub #406). Electron’s native About / Win32 task-dialog
 * path can crash the process; this HTML is loaded in a sandboxed BrowserWindow instead.
 */

const ABOUT_URL_WEBSITE = 'https://coloradomesh.org/';
const ABOUT_URL_GITHUB = 'https://github.com/Colorado-Mesh/mesh-client';
const ABOUT_URL_DISCORD = 'https://discord.com/invite/McChKR5NpS';

export function escapeHtmlText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Minimal self-contained HTML; links are https only (opened via main process). */
export function buildWindowsAboutDocumentHtml(appName: string, version: string): string {
  const title = escapeHtmlText(appName);
  const ver = escapeHtmlText(version);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>About ${title}</title>
<style>
  body { font-family: system-ui, Segoe UI, sans-serif; padding: 20px; margin: 0; font-size: 14px; line-height: 1.45; color: CanvasText; background: Canvas; }
  h1 { font-size: 18px; margin: 0 0 12px; font-weight: 600; }
  .ver { opacity: 0.85; margin-bottom: 16px; }
  p { margin: 10px 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 22px; align-items: center; }
  .action-btn, .close-btn {
    display: inline-block;
    box-sizing: border-box;
    padding: 8px 14px;
    font: inherit;
    cursor: pointer;
    border: 1px solid ButtonBorder;
    border-radius: 4px;
    background: ButtonFace;
    color: ButtonText;
    text-decoration: none;
    text-align: center;
    min-width: 5.5rem;
  }
  .action-btn:focus-visible, .close-btn:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
</style></head><body>
  <h1>${title}</h1>
  <div class="ver">Version ${ver}</div>
  <p>Cross-platform Electron desktop client for Meshtastic and MeshCore on macOS, Linux, and Windows with multi-language support, BLE, USB serial, Wi-Fi/TCP, MQTT, local SQLite history, routing diagnostics, and keyboard-first workflows.</p>
  <p>License: MIT &middot; Author: Colorado Mesh</p>
  <div class="actions" role="group" aria-label="About actions">
    <button type="button" class="close-btn" onclick="window.close()" aria-label="Close About window">Close</button>
    <a class="action-btn" role="button" href="${ABOUT_URL_WEBSITE}" aria-label="Open Colorado Mesh website">Website</a>
    <a class="action-btn" role="button" href="${ABOUT_URL_GITHUB}" aria-label="Open GitHub repository">GitHub</a>
    <a class="action-btn" role="button" href="${ABOUT_URL_DISCORD}" aria-label="Open Discord invite">Discord</a>
  </div>
</body></html>`;
}
