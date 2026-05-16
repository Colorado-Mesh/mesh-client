/**
 * Copy plain text to the system clipboard.
 * Electron sandboxed renderers often reject navigator.clipboard; preload uses native clipboard.
 */
export async function writeClipboardText(text: string): Promise<void> {
  if (typeof text !== 'string') {
    throw new TypeError('writeClipboardText: text must be a string');
  }
  if (typeof window.electronAPI?.clipboard?.writeText === 'function') {
    await window.electronAPI.clipboard.writeText(text);
    return;
  }
  if (typeof navigator.clipboard?.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  throw new Error('Clipboard API unavailable');
}
