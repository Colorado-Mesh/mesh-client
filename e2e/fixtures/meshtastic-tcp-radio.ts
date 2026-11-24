import { createServer, type Socket } from 'node:net';

import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { Channel, Mesh, Portnums } from '@meshtastic/protobufs';

/** Local Meshtastic TCP (port 4403 PhoneAPI) fixture: real Electron TCP path, no radio. */
export async function startMeshtasticTcpRadio(opts?: {
  myNodeNum?: number;
  longName?: string;
  shortName?: string;
}) {
  const myNodeNum = opts?.myNodeNum ?? 0x11111111;
  const longName = opts?.longName ?? 'E2E Meshtastic';
  const shortName = opts?.shortName ?? 'E2E';
  const sockets = new Set<Socket>();
  const outboundTexts: string[] = [];
  let fromRadioId = 1;
  let lastWantConfigId: number | null = null;

  const frameFromRadio = (fromRadio: Mesh.FromRadio): Buffer => {
    const payload = Buffer.from(toBinary(Mesh.FromRadioSchema, fromRadio));
    const header = Buffer.from([0x94, 0xc3, (payload.length >> 8) & 0xff, payload.length & 0xff]);
    return Buffer.concat([header, payload]);
  };

  const sendFromRadio = (socket: Socket, fromRadio: Mesh.FromRadio) => {
    socket.write(frameFromRadio(fromRadio));
  };

  const handshake = (socket: Socket, configId: number) => {
    lastWantConfigId = configId;
    const myInfo = create(Mesh.MyNodeInfoSchema, {
      myNodeNum,
      rebootCount: 1,
    });
    const user = create(Mesh.UserSchema, {
      id: `!${myNodeNum.toString(16).padStart(8, '0')}`,
      longName,
      shortName,
    });
    const nodeInfo = create(Mesh.NodeInfoSchema, {
      num: myNodeNum,
      user,
      lastHeard: Math.floor(Date.now() / 1000),
    });
    const channel = create(Channel.ChannelSchema, {
      index: 0,
      role: Channel.Channel_Role.PRIMARY,
      settings: create(Channel.ChannelSettingsSchema, {
        name: 'LongFast',
        psk: new Uint8Array(32),
      }),
    });
    const metadata = create(Mesh.DeviceMetadataSchema, {
      firmwareVersion: '2.6.0',
      deviceStateVersion: 24,
    });

    sendFromRadio(
      socket,
      create(Mesh.FromRadioSchema, {
        id: fromRadioId++,
        payloadVariant: { case: 'myInfo', value: myInfo },
      }),
    );
    sendFromRadio(
      socket,
      create(Mesh.FromRadioSchema, {
        id: fromRadioId++,
        payloadVariant: { case: 'nodeInfo', value: nodeInfo },
      }),
    );
    sendFromRadio(
      socket,
      create(Mesh.FromRadioSchema, {
        id: fromRadioId++,
        payloadVariant: { case: 'channel', value: channel },
      }),
    );
    sendFromRadio(
      socket,
      create(Mesh.FromRadioSchema, {
        id: fromRadioId++,
        payloadVariant: { case: 'metadata', value: metadata },
      }),
    );
    sendFromRadio(
      socket,
      create(Mesh.FromRadioSchema, {
        id: fromRadioId++,
        payloadVariant: { case: 'configCompleteId', value: configId },
      }),
    );
  };

  const echoText = (socket: Socket, text: string) => {
    const packet = create(Mesh.MeshPacketSchema, {
      id: fromRadioId++,
      from: myNodeNum ^ 0x22222222,
      to: 0xffffffff,
      channel: 0,
      payloadVariant: {
        case: 'decoded',
        value: create(Mesh.DataSchema, {
          portnum: Portnums.PortNum.TEXT_MESSAGE_APP,
          payload: new TextEncoder().encode(text),
        }),
      },
    });
    sendFromRadio(
      socket,
      create(Mesh.FromRadioSchema, {
        id: fromRadioId++,
        payloadVariant: { case: 'packet', value: packet },
      }),
    );
  };

  const handleToRadio = (socket: Socket, payload: Buffer) => {
    let toRadio: Mesh.ToRadio;
    try {
      toRadio = fromBinary(Mesh.ToRadioSchema, payload);
    } catch {
      return;
    }
    const variant = toRadio.payloadVariant;
    if (variant.case === 'wantConfigId') {
      handshake(socket, variant.value);
      return;
    }
    if (variant.case === 'packet') {
      const packet = variant.value;
      const decoded = packet.payloadVariant;
      if (
        decoded.case === 'decoded' &&
        decoded.value.portnum === Portnums.PortNum.TEXT_MESSAGE_APP
      ) {
        const text = new TextDecoder().decode(decoded.value.payload);
        outboundTexts.push(text);
        // Echo so the renderer can show an inbound chat line when handshake is complete.
        echoText(socket, `echo:${text}`);
      }
    }
  };

  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const code = err.code;
      if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'ECONNABORTED') return;
      console.error('[meshtastic-tcp-radio] unexpected socket error', err);
    });
    socket.on('close', () => sockets.delete(socket));
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        if (buffer[0] !== 0x94 || buffer[1] !== 0xc3) {
          buffer = Buffer.from(buffer.subarray(1));
          continue;
        }
        const len = (buffer[2] << 8) | buffer[3];
        if (buffer.length < 4 + len) break;
        const payload = Buffer.from(buffer.subarray(4, 4 + len));
        buffer = Buffer.from(buffer.subarray(4 + len));
        handleToRadio(socket, payload);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('meshtastic tcp radio: missing listen address');
  }

  return {
    port: addr.port,
    host: '127.0.0.1',
    address: `127.0.0.1:${addr.port}`,
    outboundTexts,
    get lastWantConfigId() {
      return lastWantConfigId;
    },
    async close() {
      for (const s of sockets) s.destroy();
      sockets.clear();
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}
