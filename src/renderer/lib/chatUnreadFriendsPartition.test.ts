import { describe, expect, it, vi } from 'vitest';

import { partitionDmUnreadByFriends, sumUnreadMap } from '@/renderer/lib/chatUnreadCounts';
import * as reticulumDmIds from '@/renderer/lib/reticulum/resolveReticulumChatLxmfDest';

describe('partitionDmUnreadByFriends', () => {
  it('splits friend vs other DM unreads without double counting', () => {
    const dm = new Map([
      [1, 2],
      [2, 5],
      [3, 1],
    ]);
    const friends = new Set([2, 9]);
    expect(partitionDmUnreadByFriends(dm, friends)).toEqual({
      friendsUnread: 5,
      otherDmUnread: 3,
    });
    expect(sumUnreadMap(dm)).toBe(8);
  });

  it('counts friend unreads when stored friend id is equivalent to the DM peer', () => {
    const equiv = vi
      .spyOn(reticulumDmIds, 'reticulumChatDmNodeIdsEquivalent')
      .mockImplementation((a, b) => (a === 10 && b === 20) || (a === 20 && b === 10));
    try {
      const dm = new Map([[20, 4]]);
      expect(partitionDmUnreadByFriends(dm, new Set([10]))).toEqual({
        friendsUnread: 4,
        otherDmUnread: 0,
      });
    } finally {
      equiv.mockRestore();
    }
  });
});
