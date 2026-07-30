import type { MeshcoreContactDbRow } from './meshcore/meshcoreHookTypes';

export interface MeshcoreContactPathDiagnosticRow {
  nodeId: number;
  advName: string | null;
  hopsAway: number | null;
  contactType: number;
  onRadio: number;
  lastAdvert: number | null;
  /** First 12 hex chars of pubkey (prefix only — no full key in exports). */
  pubKeyPrefixHex: string;
  /** Best known path bytes from SQLite path history for this node. */
  bestPathBytes: number[];
  bestPathHopCount: number | null;
}

function pubKeyPrefixHexFromRow(row: MeshcoreContactDbRow): string {
  const hex = row.public_key.replace(/\s/g, '').toLowerCase();
  return hex.slice(0, 12);
}

/** Redacted MeshCore contact + path history rows for support bundle / debug snapshot. */
export async function fetchMeshcoreContactPathDiagnostics(): Promise<
  MeshcoreContactPathDiagnosticRow[]
> {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- Runtime guard protects external or callback-mutated state.
  if (typeof window === 'undefined' || !window.electronAPI?.db?.getMeshcoreContacts) {
    return [];
  }
  try {
    const [contacts, pathRows] = await Promise.all([
      window.electronAPI.db.getMeshcoreContacts() as Promise<MeshcoreContactDbRow[]>,
      window.electronAPI.db.getAllMeshcorePathHistory(),
    ]);
    const bestByNode = new Map<
      number,
      { pathBytes: number[]; hopCount: number | null; successCount: number }
    >();
    for (const row of pathRows as {
      node_id: number;
      path_bytes: string;
      hop_count: number;
      success_count: number;
      updated_at: number;
    }[]) {
      let pathBytes: number[] = [];
      try {
        pathBytes = JSON.parse(row.path_bytes) as number[];
      } catch {
        // catch-no-log-ok malformed path_bytes
      }
      const existing = bestByNode.get(row.node_id);
      if (
        !existing ||
        row.success_count > existing.successCount ||
        (row.success_count === existing.successCount &&
          pathBytes.length > existing.pathBytes.length)
      ) {
        bestByNode.set(row.node_id, {
          pathBytes,
          hopCount: row.hop_count,
          successCount: row.success_count,
        });
      }
    }
    return contacts.map((row) => {
      const best = bestByNode.get(row.node_id);
      return {
        nodeId: row.node_id,
        advName: row.adv_name,
        hopsAway: row.hops_away,
        contactType: row.contact_type,
        onRadio: row.on_radio,
        lastAdvert: row.last_advert,
        pubKeyPrefixHex: pubKeyPrefixHexFromRow(row),
        bestPathBytes: best?.pathBytes ?? [],
        bestPathHopCount: best?.hopCount ?? null,
      };
    });
  } catch {
    // catch-no-log-ok debug snapshot is best-effort; renderer may lack IPC
    return [];
  }
}
