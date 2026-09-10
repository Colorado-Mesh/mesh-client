import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppTrayUnreadSync } from './useAppTrayUnreadSync';

describe('useAppTrayUnreadSync', () => {
  beforeEach(() => {
    vi.mocked(window.electronAPI.setTrayUnread).mockClear();
  });

  it.each(['darwin', 'linux', 'win32'] as const)(
    'syncs unread messages across protocols and clears the badge when read on %s',
    (platform) => {
      vi.mocked(window.electronAPI.getPlatform).mockReturnValue(platform);
      const { rerender } = renderHook(
        ({ counts }) => {
          useAppTrayUnreadSync(...counts);
        },
        {
          initialProps: { counts: [1, 2, 3, 4, 5] as [number, number, number, number, number] },
        },
      );
      expect(window.electronAPI.setTrayUnread).toHaveBeenLastCalledWith(15);
      rerender({ counts: [0, 2, 0, 0, 0] });
      expect(window.electronAPI.setTrayUnread).toHaveBeenLastCalledWith(2);
      rerender({ counts: [0, 0, 0, 0, 0] });
      expect(window.electronAPI.setTrayUnread).toHaveBeenLastCalledWith(0);
    },
  );
});
