import { describe, expect, it } from 'vitest';

import { buildMeshcoreRoomIncomingMessage } from './meshcoreChannelText';
import { computeRoomUnreadCounts, totalRoomsUnreadCount } from './meshcoreRoomsUnread';

const ownNodes = new Set([0x100]);

describe('meshcoreRoomsUnread', () => {
  it('counts unread room posts newer than last-read watermark', () => {
    const msg = buildMeshcoreRoomIncomingMessage({
      rawText: 'Hello room',
      roomServerId: 0x200,
      authorId: 0x300,
      authorName: 'Alice',
      timestamp: 2000,
      receivedVia: 'rf',
    });
    const counts = computeRoomUnreadCounts([msg], { 0x200: 1500 }, ownNodes);
    expect(counts.get(0x200)).toBe(1);
  });

  it('skips sending and failed outbound rows', () => {
    const stuck = buildMeshcoreRoomIncomingMessage({
      rawText: 'stuck',
      roomServerId: 0x200,
      authorId: 0x300,
      authorName: 'Alice',
      timestamp: 5000,
      receivedVia: 'rf',
    });
    stuck.status = 'sending';
    expect(totalRoomsUnreadCount([stuck], {}, new Set())).toBe(0);
  });

  it('skips own posts and history rows', () => {
    const own = buildMeshcoreRoomIncomingMessage({
      rawText: 'Mine',
      roomServerId: 0x200,
      authorId: 0x100,
      authorName: 'Me',
      timestamp: 2000,
      receivedVia: 'rf',
    });
    const history = buildMeshcoreRoomIncomingMessage({
      rawText: 'Old',
      roomServerId: 0x200,
      authorId: 0x300,
      authorName: 'Alice',
      timestamp: 2000,
      receivedVia: 'rf',
    });
    history.isHistory = true;
    const counts = computeRoomUnreadCounts([own, history], {}, ownNodes);
    expect(counts.size).toBe(0);
  });

  it('totalRoomsUnreadCount sums all rooms', () => {
    const a = buildMeshcoreRoomIncomingMessage({
      rawText: 'A',
      roomServerId: 0x200,
      authorId: 0x300,
      authorName: 'Alice',
      timestamp: 2000,
      receivedVia: 'rf',
    });
    const b = buildMeshcoreRoomIncomingMessage({
      rawText: 'B',
      roomServerId: 0x201,
      authorId: 0x301,
      authorName: 'Bob',
      timestamp: 3000,
      receivedVia: 'rf',
    });
    expect(totalRoomsUnreadCount([a, b], {}, ownNodes)).toBe(2);
  });

  it('counts unread for RoomsPanel-style room ids', () => {
    const roomA = 0x1005;
    const msg = buildMeshcoreRoomIncomingMessage({
      rawText: 'New post',
      roomServerId: roomA,
      authorId: 0x200,
      authorName: 'Alice',
      timestamp: 5000,
      receivedVia: 'rf',
    });
    const counts = computeRoomUnreadCounts([msg], {}, new Set([0x100]));
    expect(counts.get(roomA)).toBe(1);
  });
});
