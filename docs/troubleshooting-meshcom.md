# MeshCom troubleshooting

MeshCom-specific problems. For general connection, Bluetooth, USB serial, MQTT, log analysis, and bug-report help, see [Troubleshooting](troubleshooting.md). For protocol setup, see [MeshCom](development/meshcom.md).

## EXTUDP connect fails or no traffic

**Symptoms**: Connection panel shows Connecting then fails; no chat packets; Log may show `meshcom:udp-connect` bind or send errors.

**Cause**: EXTUDP uses UDP port **1799** on both the host and the radio. Another process may hold the port, or the radio’s companion IP is wrong / firewalled.

**Fix**:

1. Confirm the radio companion EXTUDP address (often the radio’s LAN IP) in the Connection panel.
2. Ensure nothing else is bound to UDP **1799** on this machine.
3. Prefer Serial or BLE if UDP is blocked on the network path.
4. Disconnect → Connect after fixing the host.

## KISS / TCP (:8001) connect stuck

**Symptoms**: TCP connect hangs; no operator callsign / chat; Log shows `meshcom:tcp-*` socket closed early.

**Cause**: MeshCom KISS over TCP expects companion TCP on port **8001**. Wrong host/port or a non-KISS listener will stall the handshake.

**Fix**:

1. Use the Connection panel **KISS/TCP** field with `host:8001` or host only (default port applied).
2. Verify the radio firmware exposes KISS TCP and that the callsign / `--setcall` identity is set (Radio → MeshCom device commands).
3. Fall back to Serial 115200 console if TCP is unavailable.

## Serial / BLE: device commands fail

**Symptoms**: Radio → MeshCom device commands stay disabled; `--settime` / `--setctry` toasts fail; console shows not connected.

**Cause**: APP-style device commands require an active **Serial** or **BLE** link (not EXTUDP-only).

**Fix**:

1. Connect via Serial (115200) or BLE, then open Radio → MeshCom commands.
2. Enable **auto `--settime`** in App settings if you want UTC clock sync after Serial/BLE connect.
3. Acknowledge the licensed-amateur notice when prompted before RF use.

## Hide MeshCom but it still reconnects

**Symptoms**: MeshCom is hidden under App → Protocols, but wake/auto-connect still touches MeshCom.

**Cause**: Hidden protocols must latch a stop so runtimes do not resume RF.

**Fix**: Toggle MeshCom off under **App → Protocols**, then Disconnect once if a session was already live. Restart the app if an old session was mid-reconnect.
