// Polls localhost:5173 until Vite is ready, then exits 0.
import net from 'net'

const HOST = 'localhost'
const PORT = 5173
const INTERVAL_MS = 300

function tryConnect() {
  const socket = net.connect(PORT, HOST)
  socket.on('connect', () => { socket.destroy(); process.exit(0) })
  socket.on('error', () => { socket.destroy(); setTimeout(tryConnect, INTERVAL_MS) })
}

tryConnect()
