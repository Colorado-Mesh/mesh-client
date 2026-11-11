/**
 * Test helper: MeshCore firmware's TRACE forwarding rule, so a test can ask whether a wire path
 * would bring TraceData back to the companion that sent it.
 *
 * Rule (firmware `Mesh::onRecvPacket`, TRACE branch): the payload carries the path as entries of
 * `1 << (flags & 3)` bytes. A node that hears the packet with `seen` SNRs already appended:
 * - reports the trace (`onTraceRecv`) when `seen` entries cover the whole path;
 * - otherwise forwards it with its own SNR appended when the next entry is a prefix of its
 *   public key, it is allowed to forward, and it has not handled this stage before.
 * The companion rejects a path that is not a whole number of entries.
 */

export interface MeshcoreTraceSimNode {
  name: string;
  pubKey: Uint8Array;
  /** Repeaters and room servers forward; a companion does not. */
  forwards: boolean;
}

export interface MeshcoreTraceSimMesh {
  /** The sending companion; it reports a finished trace and never forwards. */
  companion: string;
  nodes: readonly MeshcoreTraceSimNode[];
  /** Pairs of node names that hear each other. */
  links: readonly (readonly [string, string])[];
}

export interface MeshcoreTraceSimResult {
  /** The companion heard the trace after its last entry was consumed. */
  returned: boolean;
  /** The companion refused the command (path is not a whole number of entries). */
  rejected: boolean;
  /** Names of the nodes that forwarded, in order. */
  forwardedBy: string[];
  /** SNR bytes TraceData would carry before the final one (one per forward). */
  snrCount: number;
}

function hearsMap(mesh: MeshcoreTraceSimMesh): Map<string, Set<string>> {
  const hears = new Map<string, Set<string>>();
  const add = (a: string, b: string) => {
    const set = hears.get(a) ?? new Set<string>();
    set.add(b);
    hears.set(a, set);
  };
  for (const [a, b] of mesh.links) {
    add(a, b);
    add(b, a);
  }
  return hears;
}

function entryMatches(pubKey: Uint8Array, entry: Uint8Array): boolean {
  if (entry.length === 0 || entry.length > pubKey.length) return false;
  return entry.every((byte, i) => byte === pubKey[i]);
}

export function simulateMeshcoreTrace(
  mesh: MeshcoreTraceSimMesh,
  path: Uint8Array,
  flags: number,
): MeshcoreTraceSimResult {
  const sizeShift = flags & 0x03;
  const entrySize = 1 << sizeShift;
  const result: MeshcoreTraceSimResult = {
    returned: false,
    rejected: false,
    forwardedBy: [],
    snrCount: 0,
  };
  if (path.length === 0 || path.length % entrySize !== 0) {
    result.rejected = true;
    return result;
  }
  const entries = path.length / entrySize;
  const hears = hearsMap(mesh);
  const byName = new Map(mesh.nodes.map((n) => [n.name, n]));
  const handled = new Set<string>();
  let transmissions: { from: string; seen: number }[] = [{ from: mesh.companion, seen: 0 }];
  while (transmissions.length > 0 && !result.returned) {
    const next: { from: string; seen: number }[] = [];
    for (const tx of transmissions) {
      for (const listener of hears.get(tx.from) ?? []) {
        if (tx.seen >= entries) {
          if (listener === mesh.companion) {
            result.returned = true;
            result.snrCount = tx.seen;
          }
          continue;
        }
        const node = byName.get(listener);
        if (!node?.forwards) continue;
        const entry = path.subarray(tx.seen * entrySize, (tx.seen + 1) * entrySize);
        if (!entryMatches(node.pubKey, entry)) continue;
        const stage = `${listener}:${tx.seen}`;
        if (handled.has(stage)) continue;
        handled.add(stage);
        result.forwardedBy.push(listener);
        next.push({ from: listener, seen: tx.seen + 1 });
      }
    }
    transmissions = next;
  }
  return result;
}

/** A chain: companion, then each relay in order, then the destination. */
export function meshcoreTraceSimChain(
  relays: readonly { name: string; pubKey: Uint8Array }[],
  dest: { name: string; pubKey: Uint8Array },
): MeshcoreTraceSimMesh {
  const names = ['companion', ...relays.map((r) => r.name), dest.name];
  const links: [string, string][] = [];
  for (let i = 0; i + 1 < names.length; i++) links.push([names[i], names[i + 1]]);
  return {
    companion: 'companion',
    nodes: [
      ...relays.map((r) => ({ name: r.name, pubKey: r.pubKey, forwards: true })),
      { name: dest.name, pubKey: dest.pubKey, forwards: true },
    ],
    links,
  };
}
