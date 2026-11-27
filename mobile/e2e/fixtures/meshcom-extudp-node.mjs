// MeshCom EXTUDP node stand-in for the mobile browser harness (no RF, no firmware).
//
// Binds UDP 1799 on its own loopback address (the harness binds the app's 1799 socket to another
// loopback address), sends a broadcast chat line to the app every second (the app accepts it once
// connected; repeats share one msg_id), and prints every datagram it receives as one JSON line.
//
// Usage: node meshcom-extudp-node.mjs <node address> <app address> <message text> <source callsign>
import dgram from 'node:dgram';

const [nodeAddress, appAddress, text, src] = process.argv.slice(2);
if (!nodeAddress || !appAddress || !text || !src) {
  console.error(
    'usage: meshcom-extudp-node.mjs <node address> <app address> <message text> <source callsign>',
  );
  process.exit(2);
}

const socket = dgram.createSocket('udp4');
socket.on('message', (data) => {
  console.log(JSON.stringify({ rx: data.toString('utf8') }));
});
socket.bind(1799, nodeAddress, () => {
  const line = JSON.stringify({ type: 'msg', src, dst: '*', msg: text, msg_id: '7A11C3' });
  setInterval(() => {
    socket.send(line, 1799, appAddress);
  }, 1000);
  console.log(JSON.stringify({ ready: true }));
});
