import { useEffect, useRef } from 'react';

import { isLauncherShortcut, pinnedShortcutPosition } from '@/renderer/lib/panelLauncher';

interface Options {
  /** `window.electronAPI.getPlatform()`: Cmd on darwin, Ctrl elsewhere. */
  platform: string;
  onToggleLauncher: () => void;
  /** Ctrl/Cmd+1..4 with the 0-based pin position. */
  onPinnedShortcut: (position: number) => void;
}

/** Window-level Ctrl/Cmd+K and Ctrl/Cmd+1..4 for the all-panels launcher. Mount once from App. */
export function usePanelLauncherShortcuts({
  platform,
  onToggleLauncher,
  onPinnedShortcut,
}: Options): void {
  const handlersRef = useRef({ onToggleLauncher, onPinnedShortcut });
  useEffect(() => {
    handlersRef.current = { onToggleLauncher, onPinnedShortcut };
  }, [onToggleLauncher, onPinnedShortcut]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      if (isLauncherShortcut(e, platform)) {
        e.preventDefault();
        handlersRef.current.onToggleLauncher();
        return;
      }
      const position = pinnedShortcutPosition(e, platform);
      if (position !== null) {
        e.preventDefault();
        handlersRef.current.onPinnedShortcut(position);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [platform]);
}
