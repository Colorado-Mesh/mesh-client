import { describe, expect, it } from 'vitest';

import { partitionDmUnreadByFriends, sumUnreadMap } from '@/renderer/lib/chatUnreadCounts';

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
});
