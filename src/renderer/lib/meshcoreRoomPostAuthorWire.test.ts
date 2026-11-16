/**
 * Room posts arrive as SignedPlain ContactMsgRecv text: the author's 4-byte public-key prefix,
 * then the UTF-8 body. The prefix is raw key bytes, so it must survive meshcore.js unchanged for
 * `meshcoreRoomPostBodyFromWire` to find the author.
 */
import { Connection, Constants } from '@liamcottle/meshcore.js';
import { describe, expect, it } from 'vitest';

import { MESHCORE_TXT_TYPE_SIGNED_PLAIN } from './meshcoreChannelText';
import { meshcoreRoomPostBodyFromWire } from './meshcoreRoomMessageRouting';

/** Companion RESP_CODE_CONTACT_MSG_RECV_V3. */
const CONTACT_MSG_RECV_V3 = 16;

interface ContactMsg {
  txtType: number;
  text: string;
}

class FrameConnection extends Connection {
  received: ContactMsg[] = [];

  constructor() {
    super();
    this.on(Constants.ResponseCodes.ContactMsgRecv, (msg: unknown) => {
      this.received.push(msg as ContactMsg);
    });
  }

  async close(): Promise<void> {
    await Promise.resolve();
  }
}

const ROOM_PREFIX = [0x52, 0x4f, 0x4f, 0x4d, 0x01, 0x02];

function contactMsgV3(txtType: number, textBytes: number[]): Uint8Array {
  return new Uint8Array([
    CONTACT_MSG_RECV_V3,
    24,
    0,
    0,
    ...ROOM_PREFIX,
    0xff,
    txtType,
    0x10,
    0x20,
    0x30,
    0x40,
    ...textBytes,
  ]);
}

/** meshcore.js delivers each event from a `setTimeout(0)`. */
async function receive(txtType: number, textBytes: number[]): Promise<ContactMsg> {
  const conn = new FrameConnection();
  conn.onFrameReceived(contactMsgV3(txtType, textBytes));
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  expect(conn.received).toHaveLength(1);
  return conn.received[0];
}

const utf8 = (s: string) => [...new TextEncoder().encode(s)];
const hex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
/** "cafe" with an acute e, then a space and the wireless emoji. */
const NON_ASCII_BODY = `caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x1f6dc)}`;

describe('SignedPlain room post author prefix through meshcore.js', () => {
  it.each([
    ['ASCII bytes', [0x41, 0x42, 0x43, 0x44]],
    ['bytes 0x80-0xff', [0xa3, 0x1f, 0x5c, 0x7e]],
    ['a byte pair that is valid UTF-8', [0xc2, 0x88, 0x41, 0x42]],
    ['a 0x00 byte', [0x41, 0x00, 0x42, 0x43]],
    ['all four bytes high', [0xd0, 0xd1, 0xd2, 0xd3]],
  ])('finds the author and keeps the body when the prefix has %s', async (_label, prefix) => {
    const msg = await receive(MESHCORE_TXT_TYPE_SIGNED_PLAIN, [...prefix, ...utf8('hello room')]);
    const authors = new Map([[hex(prefix), 0x1234]]);
    expect(meshcoreRoomPostBodyFromWire(msg.text, msg.txtType, authors)).toEqual({
      authorId: 0x1234,
      payload: 'hello room',
    });
  });

  it('keeps a non-ASCII body intact after the prefix', async () => {
    const prefix = [0xa3, 0x1f, 0x5c, 0x7e];
    const msg = await receive(MESHCORE_TXT_TYPE_SIGNED_PLAIN, [...prefix, ...utf8(NON_ASCII_BODY)]);
    expect(meshcoreRoomPostBodyFromWire(msg.text, msg.txtType, new Map()).payload).toBe(
      NON_ASCII_BODY,
    );
  });

  it('still stops the body at a firmware NUL terminator', async () => {
    const msg = await receive(MESHCORE_TXT_TYPE_SIGNED_PLAIN, [
      0xa3,
      0x1f,
      0x5c,
      0x7e,
      ...utf8('kept'),
      0x00,
      ...utf8('dropped'),
    ]);
    expect(meshcoreRoomPostBodyFromWire(msg.text, msg.txtType, new Map()).payload).toBe('kept');
  });

  it('decodes a SignedPlain text shorter than a prefix as UTF-8, as before', async () => {
    const shortText = String.fromCodePoint(0xe9);
    expect((await receive(MESHCORE_TXT_TYPE_SIGNED_PLAIN, utf8(shortText))).text).toBe(shortText);
  });

  it('leaves plain contact messages decoded as UTF-8', async () => {
    expect((await receive(0, utf8(NON_ASCII_BODY))).text).toBe(NON_ASCII_BODY);
  });
});
