import { beforeEach, describe, expect, it } from 'vitest';

import {
  friendNodeIdSet,
  resetFriendsStoreForTests,
  useFriendsStore,
} from '@/renderer/stores/friendsStore';

describe('friendsStore', () => {
  beforeEach(() => {
    resetFriendsStoreForTests();
  });

  it('adds and removes friends per identity without duplicates', () => {
    const s = useFriendsStore.getState();
    s.addFriend('id-a', 10);
    s.addFriend('id-a', 10);
    s.addFriend('id-a', 20);
    s.addFriend('id-b', 10);
    expect(s.listFriends('id-a')).toEqual([10, 20]);
    expect(s.listFriends('id-b')).toEqual([10]);
    expect(s.isFriend('id-a', 10)).toBe(true);
    s.removeFriend('id-a', 10);
    expect(useFriendsStore.getState().listFriends('id-a')).toEqual([20]);
    expect(friendNodeIdSet('id-a')).toEqual(new Set([20]));
  });

  it('ignores invalid node ids', () => {
    useFriendsStore.getState().addFriend('id-a', 0);
    useFriendsStore.getState().addFriend('id-a', -3);
    useFriendsStore.getState().addFriend('', 5);
    expect(useFriendsStore.getState().byIdentity).toEqual({});
  });
});
