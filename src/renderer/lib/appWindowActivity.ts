import { useEffect, useState } from 'react';

/**
 * "User isn't actively looking at the app" signal for read-marking and background
 * notification gates. Combines Page Visibility (`document.hidden`) with window focus
 * (`document.hasFocus()`): a visible-but-unfocused Electron window (uncovered window,
 * second display, Stage Manager, spaces quirk) counts as inactive so open-conversation
 * traffic still bumps unread and produces an OS dock/tray badge.
 *
 * Use this for user-attention gates only. Keep bare `document.hidden` for
 * resource/polling paths (heartbeat, topology refresh) that should keep running
 * whenever the window is merely visible.
 */
export function isAppWindowInactive(): boolean {
  return document.hidden || !document.hasFocus();
}

export interface AppWindowActivity {
  inactive: boolean;
  hidden: boolean;
  focused: boolean;
}

function readActivity(): AppWindowActivity {
  const hidden = document.hidden;
  const focused = document.hasFocus();
  return { inactive: hidden || !focused, hidden, focused };
}

/**
 * React hook mirroring {@link isAppWindowInactive}. Re-renders on `window`
 * `focus`/`blur` and `document` `visibilitychange`.
 */
export function useAppWindowActivity(): AppWindowActivity {
  const [activity, setActivity] = useState<AppWindowActivity>(readActivity);

  useEffect(() => {
    const update = () => {
      setActivity((prev) => {
        const next = readActivity();
        if (
          prev.inactive === next.inactive &&
          prev.hidden === next.hidden &&
          prev.focused === next.focused
        ) {
          return prev;
        }
        return next;
      });
    };

    update();
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  return activity;
}
