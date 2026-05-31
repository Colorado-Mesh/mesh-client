/** Parsed ACL row from room server `get acl` CLI output. */
export interface MeshcoreRoomAclEntry {
  pubkeyHex: string;
  permissionLevel: number;
  /** True when the firmware returned a pubkey prefix shorter than 64 hex chars. */
  pubkeyPrefix: boolean;
}

const ACL_LINE_RE = /([0-9a-f]{8,64})\s*[:,\s|]+\s*([0-3])\b/i;

/**
 * Parse `get acl` (or similar) CLI text into structured entries.
 * Firmware formats vary; we accept lines containing hex pubkey + permission 0–3.
 */
export function parseMeshcoreRoomAclResponse(response: string): MeshcoreRoomAclEntry[] {
  const entries: MeshcoreRoomAclEntry[] = [];
  const seen = new Set<string>();

  for (const line of response.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('>') || trimmed.startsWith('[')) continue;
    const match = ACL_LINE_RE.exec(trimmed);
    if (!match) continue;
    const pubkeyHex = match[1].toLowerCase();
    const permissionLevel = Number.parseInt(match[2], 10);
    const key = `${pubkeyHex}:${permissionLevel}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({
      pubkeyHex,
      permissionLevel,
      pubkeyPrefix: pubkeyHex.length < 64,
    });
  }

  return entries;
}

export function meshcoreRoomAclLevelLabel(level: number, t: (key: string) => string): string {
  switch (level) {
    case 0:
      return t('roomsPanel.aclLevelRemove');
    case 1:
      return t('roomsPanel.aclLevelGuest');
    case 2:
      return t('roomsPanel.aclLevelReadWrite');
    case 3:
      return t('roomsPanel.aclLevelAdmin');
    default:
      return String(level);
  }
}
