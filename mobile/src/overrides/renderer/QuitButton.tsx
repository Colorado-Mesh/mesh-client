/**
 * Mobile override of `src/renderer/components/shell/QuitButton.tsx`: apps are closed by the OS,
 * not from inside the app (iOS Human Interface Guidelines), so the header has no Quit control.
 * Disconnecting stays available in Device → Connection.
 */
export function QuitButton(): null {
  return null;
}
