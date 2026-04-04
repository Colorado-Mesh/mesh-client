// @vitest-environment node
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const INDEX_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8');

// ─── BrowserWindow creation ───────────────────────────────────────────────────

describe('BrowserWindow creation', () => {
  it('creates a BrowserWindow with a preload script via path.join', () => {
    // The preload path must be constructed via path.join (not a string literal)
    // to ensure it resolves correctly in both dev and packaged builds.
    expect(INDEX_SOURCE).toContain("preload: path.join(__dirname, '../preload/index.js')");
  });

  it('sets minimum window dimensions', () => {
    expect(INDEX_SOURCE).toContain('minWidth: 900');
    expect(INDEX_SOURCE).toContain('minHeight: 600');
  });
});

// ─── app lifecycle handlers ───────────────────────────────────────────────────

describe('app lifecycle handlers', () => {
  it("handles 'window-all-closed' to quit on non-darwin platforms", () => {
    const handlerIdx = INDEX_SOURCE.indexOf("app.on('window-all-closed'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 700);
    // Must check platform before quitting (darwin keeps the process alive)
    expect(body).toContain("process.platform !== 'darwin'");
    expect(body).toContain('app.quit()');
  });

  it("handles 'activate' to recreate the window when no windows exist", () => {
    const handlerIdx = INDEX_SOURCE.indexOf("app.on('activate'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 300);
    expect(body).toContain('BrowserWindow.getAllWindows()');
  });

  it("handles 'before-quit' for graceful shutdown", () => {
    expect(INDEX_SOURCE).toContain("app.on('before-quit'");
  });
});

// ─── Navigation security ──────────────────────────────────────────────────────

describe('navigation and window-open security', () => {
  it('registers a will-navigate handler', () => {
    expect(INDEX_SOURCE).toContain("on('will-navigate'");
  });

  it('calls event.preventDefault() in will-navigate when navigating externally', () => {
    const handlerIdx = INDEX_SOURCE.indexOf("on('will-navigate'");
    expect(handlerIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(handlerIdx, handlerIdx + 350);
    expect(body).toContain('event.preventDefault()');
  });

  it('uses setWindowOpenHandler to intercept all window.open calls', () => {
    expect(INDEX_SOURCE).toContain('setWindowOpenHandler');
  });
});

// ─── Session permission handlers ─────────────────────────────────────────────

describe('session permission handlers', () => {
  it('registers both setPermissionCheckHandler and setPermissionRequestHandler', () => {
    expect(INDEX_SOURCE).toContain('setPermissionCheckHandler');
    expect(INDEX_SOURCE).toContain('setPermissionRequestHandler');
  });

  it('does not call setPermissionCheckHandler with a blanket return true', () => {
    const checkIdx = INDEX_SOURCE.indexOf('setPermissionCheckHandler');
    expect(checkIdx).toBeGreaterThan(-1);
    const body = INDEX_SOURCE.slice(checkIdx, checkIdx + 300);
    // Blanket 'return true' inside the handler would grant all permissions
    expect(body).not.toMatch(/setPermissionCheckHandler[^{]*\{[^}]*return true/s);
  });
});

// ─── did-fail-load error handling ────────────────────────────────────────────

describe('renderer load error handling', () => {
  it("handles 'did-fail-load' on webContents", () => {
    expect(INDEX_SOURCE).toContain("on('did-fail-load'");
  });
});
