/**
 * One WebSocket to the MeshNet web bridge (scripts/mobile-web-bridge.mjs), shared by the web
 * plugin implementations (MeshNet, MeshProcess, MeshDevice) in the browser harness.
 *
 * Bridge URL: `globalThis.__MESH_WEB_BRIDGE__`, else localStorage `mesh-mobile:web-bridge` (the
 * bridge prints the URL with its per-run token at start). Without one, calls reject with
 * "bridge unavailable" and callers fall back where they can.
 */
type Listener = (data: unknown) => void;

function bridgeUrl(): string | null {
  const g = (globalThis as { __MESH_WEB_BRIDGE__?: string }).__MESH_WEB_BRIDGE__;
  if (g) return g;
  try {
    return localStorage.getItem('mesh-mobile:web-bridge');
  } catch {
    return null; // catch-no-log-ok storage blocked
  }
}

class BridgeClient {
  private ws: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private readonly listeners = new Map<string, Set<Listener>>();

  private connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws);
    const url = bridgeUrl();
    if (!url)
      return Promise.reject(new Error('MeshNet web bridge unavailable (no bridge URL configured)'));
    this.opening ??= new Promise<WebSocket>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => {
        this.ws = ws;
        this.opening = null;
        resolve(ws);
      };
      ws.onerror = () => {
        this.opening = null;
        reject(new Error('MeshNet web bridge unavailable'));
      };
      ws.onclose = () => {
        this.ws = null;
        for (const p of this.pending.values()) p.reject(new Error('MeshNet web bridge closed'));
        this.pending.clear();
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(String(ev.data)) as {
          id?: number;
          ok?: boolean;
          value?: unknown;
          error?: string;
          event?: string;
          data?: unknown;
        };
        if (msg.event) {
          for (const l of this.listeners.get(msg.event) ?? []) l(msg.data);
          return;
        }
        const p = msg.id !== undefined ? this.pending.get(msg.id) : undefined;
        if (!p || msg.id === undefined) return;
        this.pending.delete(msg.id);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(new Error(msg.error ?? 'bridge error'));
      };
    });
    return this.opening;
  }

  async call(op: string, args: unknown): Promise<unknown> {
    const ws = await this.connect();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, op, args }));
    });
  }

  on(event: string, listener: Listener): void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener);
  }
}

export const bridgeClient = new BridgeClient();
