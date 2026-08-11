/**
 * Static control page for headless server mode (issue #824).
 *
 * A single self-contained HTML document (no build step, no external assets): the
 * browser connects a WebSocket, receives `hello` dimensions, streams JPEG frames
 * into a canvas scaled to the window, and forwards pointer / wheel / keyboard
 * events back to the Electron main process. English-only (non-goal: i18n) —
 * `check:i18n` does not scan this surface; see docs/agents/i18n.md.
 *
 * Security: the page is served with a restrictive CSP (no remote origins, inline
 * script only) and is the only external surface besides `/health`. The token is
 * never embedded in HTML; it travels via the `/?token=` query (cookie) and the
 * WS handshake only. Auth UX for missing tokens is `buildMissingTokenPageHtml`.
 */
export function buildRemoteControlPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src 'self' data: blob:; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'">
<meta name="referrer" content="no-referrer">
<title>Mesh-Client — Remote</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: #0b1220; color: #cbd5e1;
    font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
  #wrap { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
  canvas { display: block; background: #000; }
  #status { position: fixed; left: 8px; bottom: 8px; padding: 4px 8px; border-radius: 6px;
    background: rgba(15,23,42,0.85); color: #94a3b8; font-size: 12px; user-select: none; pointer-events: none; }
  #status.error { color: #f87171; }
  #status.live { color: #4ade80; }
</style>
</head>
<body>
<div id="wrap"><canvas id="screen" aria-label="Mesh-Client remote display"></canvas></div>
<div id="status" role="status" aria-live="polite">Connecting\u2026</div>
<script>
(function () {
  'use strict';
  var canvas = document.getElementById('screen');
  var ctx = canvas.getContext('2d');
  var statusEl = document.getElementById('status');
  var ws = null;
  var dims = null;
  var reconnectTimer = null;
  var connectedAt = 0;
  var framesSinceReport = 0;
  var fpsTimer = null;
  var stopReconnect = false;

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = cls || '';
  }

  function wsUri() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    var url = proto + '//' + location.host + '/ws';
    var token = new URLSearchParams(location.search).get('token');
    if (token) {
      url += (url.indexOf('?') === -1 ? '?' : '&') + 'token=' + encodeURIComponent(token);
    }
    return url;
  }

  function connect() {
    if (stopReconnect) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    clearTimeout(reconnectTimer);
    setStatus('Connecting\u2026');
    try {
      ws = new WebSocket(wsUri());
    } catch (err) {
      // catch-no-log-ok surfaced to the user via the on-page status line
      setStatus('WebSocket error: ' + String(err), 'error');
      scheduleReconnect();
      return;
    }
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      connectedAt = Date.now();
      framesSinceReport = 0;
      setStatus('Connected');
    };

    ws.onmessage = function (ev) {
      if (typeof ev.data === 'string') {
        onControl(ev.data);
        return;
      }
      onBinary(ev.data);
    };

    ws.onclose = function (ev) {
      ws = null;
      if (ev.code === 1008 || ev.code === 4401) {
        stopReconnect = true;
        setStatus('Unauthorized \u2014 reload with a valid token', 'error');
        return;
      }
      setStatus('Disconnected (code ' + ev.code + ') \u2014 retrying', 'error');
      scheduleReconnect();
    };

    ws.onerror = function () {
      setStatus('Connection error', 'error');
    };
  }

  function scheduleReconnect() {
    if (stopReconnect) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 2500);
  }

  function onControl(raw) {
    var msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      // catch-no-log-ok dropped: malformed control frame from a browser client
      return;
    }
    if (msg && msg.type === 'hello') {
      dims = { width: msg.width, height: msg.height };
      canvas.width = dims.width;
      canvas.height = dims.height;
      fitCanvas();
      setStatus('Connected \u2014 ' + dims.width + 'x' + dims.height, 'live');
      startFpsReport();
    }
  }

  function onBinary(data) {
    if (!dims) return;
    framesSinceReport += 1;
    var blob = new Blob([data], { type: 'image/jpeg' });
    createImageBitmap(blob).then(function (bmp) {
      if (dims) {
        ctx.drawImage(bmp, 0, 0, dims.width, dims.height);
      }
      bmp.close();
    }).catch(function () { /* skip a bad frame; next tick replaces it */ });
  }

  function startFpsReport() {
    if (fpsTimer) return;
    fpsTimer = setInterval(function () {
      if (!dims || !connectedAt) return;
      var w = Math.floor((Date.now() - connectedAt) / 1000);
      var fps = w > 0 ? Math.round(framesSinceReport / w) : 0;
      setStatus('Live \u2014 ' + dims.width + 'x' + dims.height + ' \u00b7 ' + fps + ' fps', 'live');
      connectedAt = Date.now();
      framesSinceReport = 0;
    }, 2500);
  }

  function fitCanvas() {
    if (!dims) return;
    var wr = window.innerWidth / dims.width;
    var hr = window.innerHeight / dims.height;
    var scale = Math.min(wr, hr, 1);
    canvas.style.width = Math.floor(dims.width * scale) + 'px';
    canvas.style.height = Math.floor(dims.height * scale) + 'px';
  }

  function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(msg));
      } catch (err) {
        // catch-no-log-ok transient send failure; reconnect path handles teardown
      }
    }
  }

  function mouseButton(button) {
    if (button === 1) return 'middle';
    if (button === 2) return 'right';
    return 'left';
  }

  canvas.addEventListener('pointermove', function (e) {
    var p = logicalPos(e.clientX, e.clientY);
    send({ type: 'mousemove', x: p.x, y: p.y, buttons: e.buttons });
    if (e.buttons !== 0) e.preventDefault();
  });

  canvas.addEventListener('pointerdown', function (e) {
    var p = logicalPos(e.clientX, e.clientY);
    send({ type: 'mousedown', x: p.x, y: p.y, button: mouseButton(e.button) });
    e.preventDefault();
  });

  canvas.addEventListener('pointerup', function (e) {
    var p = logicalPos(e.clientX, e.clientY);
    send({ type: 'mouseup', x: p.x, y: p.y, button: mouseButton(e.button) });
    e.preventDefault();
  });

  canvas.addEventListener('wheel', function (e) {
    var p = logicalPos(e.clientX, e.clientY);
    send({ type: 'wheel', x: p.x, y: p.y, deltaX: e.deltaX, deltaY: e.deltaY });
    e.preventDefault();
  }, { passive: false });

  function logicalPos(clientX, clientY) {
    var r = canvas.getBoundingClientRect();
    var sx = dims ? dims.width / r.width : 1;
    var sy = dims ? dims.height / r.height : 1;
    return { x: Math.round((clientX - r.left) * sx), y: Math.round((clientY - r.top) * sy) };
  }

  function modifiersFromEvent(e) {
    var out = [];
    if (e.ctrlKey) out.push('ctrl');
    if (e.altKey) out.push('alt');
    if (e.shiftKey) out.push('shift');
    if (e.metaKey) out.push('meta');
    return out;
  }

  window.addEventListener('keydown', function (e) {
    send({ type: 'keydown', key: e.key, code: e.code, modifiers: modifiersFromEvent(e) });
    e.preventDefault();
  });

  window.addEventListener('keyup', function (e) {
    send({ type: 'keyup', key: e.key, code: e.code, modifiers: modifiersFromEvent(e) });
    e.preventDefault();
  });

  window.addEventListener('resize', fitCanvas);

  if (!window.WebSocket) {
    setStatus('This browser does not support WebSockets', 'error');
    return;
  }
  connect();
})();
</script>
</body>
</html>`;
}

/** Human-readable agent + accept header used by `/health` checks. */
export function remoteHealthJson(
  ready: boolean,
  rendererLoaded: boolean,
  uptimeSec: number,
): string {
  return JSON.stringify({ ok: ready, ready, rendererLoaded, uptimeSec });
}

/** Minimal 401 page: token form that re-requests `/?token=…` (server then sets the cookie). */
export function buildMissingTokenPageHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'">
<title>Mesh-Client — Token required</title>
<style> body { margin: 0; height: 100vh; display: flex; flex-direction: column; gap: 12px;
  align-items: center; justify-content: center; background: #0b1220; color: #cbd5e1;
  font: 14px system-ui, sans-serif; }
  input { padding: 8px 10px; border-radius: 8px; border: 1px solid #334155; background: #0f172a; color: #e2e8f0; }
  button { padding: 8px 18px; border-radius: 8px; border: 0; background: #16a34a; color: #fff; cursor: pointer; }
</style>
</head>
<body>
<form method="get" action="/">
  <label for="token">This Mesh-Client is token-protected. Enter the access token to continue.</label>
  <input id="token" name="token" type="password" autocomplete="off" aria-label="Access token">
  <button type="submit">Connect</button>
</form>
</body>
</html>`;
}
