import { createServer, type Socket } from 'node:net';

/** Local companion protocol fixture: real Electron TCP/SDK/DB path, no radio or RF. */
export async function startMeshcoreRadio() {
  const sockets = new Set<Socket>();
  const commands: number[] = [];
  let channels = ['Zulu', 'Alpha', 'Beta'];
  let rooms = ['Zulu Room', 'Alpha Room'];
  let failChannelRead = false;
  const text = (value: string, length: number) => {
    const bytes = Buffer.alloc(length);
    bytes.write(value, 0, length - 1);
    return bytes;
  };
  const u32 = (value: number) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
  };
  const publicKey = (id: number) => {
    const key = Buffer.alloc(32);
    key.writeUInt32LE(id);
    return key;
  };
  const self = Buffer.concat([
    Buffer.from([5, 1, 22, 22]),
    publicKey(171),
    Buffer.alloc(12),
    u32(902000000),
    u32(250000),
    Buffer.from([10, 5]),
    Buffer.from('Test Radio'),
  ]);
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    const send = (payload: Buffer) => {
      const header = Buffer.from([0x3e, payload.length & 255, payload.length >> 8]);
      socket.write(Buffer.concat([header, payload]));
    };
    const receive = (command: Buffer) => {
      commands.push(command[0]);
      switch (command[0]) {
        case 1:
          send(self);
          break;
        case 22:
          send(
            Buffer.concat([
              Buffer.from([13, 14, 100, channels.length, 0, 0, 0, 0]),
              text('2026-10-27', 12),
              text('E2E Radio', 40),
              text('1.18.0', 20),
              Buffer.from([0, 0]),
            ]),
          );
          break;
        case 4:
          send(Buffer.concat([Buffer.from([2]), u32(rooms.length)]));
          for (const [index, name] of rooms.entries())
            send(
              Buffer.concat([
                Buffer.from([3]),
                publicKey(192 + index),
                Buffer.from([3, 0, 0]),
                Buffer.alloc(64),
                text(name, 32),
                u32(Math.floor(Date.now() / 1000)),
                Buffer.alloc(8),
                u32(Math.floor(Date.now() / 1000)),
              ]),
            );
          send(Buffer.concat([Buffer.from([4]), u32(0)]));
          break;
        case 31: {
          const index = command[1];
          if (failChannelRead) send(Buffer.from([1, 4]));
          else if (index >= channels.length) send(Buffer.from([1, 2]));
          else
            send(
              Buffer.concat([
                Buffer.from([18, index]),
                text(channels[index], 32),
                Buffer.alloc(16, index + 1),
              ]),
            );
          break;
        }
        case 23:
          send(Buffer.from([15])); // Test radio does not export identity secrets.
          break;
        case 10:
          send(Buffer.from([10]));
          break;
        case 5:
          send(Buffer.concat([Buffer.from([9]), u32(Math.floor(Date.now() / 1000))]));
          break;
        case 20:
          send(Buffer.from([12, 0x68, 0x10]));
          break;
        case 59:
          send(Buffer.from([25, 0, 3]));
          break;
        case 56:
          send(
            Buffer.concat([
              Buffer.from([24, command[1]]),
              Buffer.alloc(command[1] === 0 ? 9 : command[1] === 1 ? 12 : 24),
            ]),
          );
          break;
        case 39:
          send(Buffer.from([1, 2]));
          break;
        default:
          send(Buffer.from([0]));
          break;
      }
    };
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, typeof data === 'string' ? Buffer.from(data) : data]);
      while (buffer.length >= 3) {
        const length = buffer.readUInt16LE(1);
        if (buffer.length < length + 3) break;
        const payload = buffer.subarray(3, length + 3);
        buffer = buffer.subarray(length + 3);
        receive(payload);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed to listen');
  return {
    port: address.port,
    commands,
    setChats: (nextChannels: string[], nextRooms: string[]) => {
      channels = nextChannels;
      rooms = nextRooms;
    },
    setReadFailure: (value: boolean) => {
      failChannelRead = value;
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) =>
        server.close(() => {
          resolve();
        }),
      );
    },
  };
}
