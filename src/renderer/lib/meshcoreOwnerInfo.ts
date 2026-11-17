import { isInfraConfigUnsupportedReply } from './meshcoreInfraConfig';

/** Contact types whose firmware runs CommonCLI, so `get owner.info` exists. */
const SUPPORTED_HW_MODELS = new Set(['Repeater', 'Room', 'Sensor']);

export type MeshcoreOwnerInfoStatus = 'ok' | 'empty' | 'unsupported' | 'needs-password' | 'error';

export interface MeshcoreOwnerInfoEntry {
  status: MeshcoreOwnerInfoStatus;
  /** Raw firmware text (`|` separators preserved) for status `ok`. */
  text?: string;
  /** Epoch ms of the read attempt. */
  fetchedAt: number;
  /** i18n-free reason token for status `error` (`invalid-reply`, `timeout`, `auth`, …). */
  reason?: string;
}

export function meshcoreOwnerInfoSupported(hwModel: string | undefined): boolean {
  return hwModel != null && SUPPORTED_HW_MODELS.has(hwModel);
}

export function parseMeshcoreOwnerInfoReply(
  reply: string,
  fetchedAt = Date.now(),
): MeshcoreOwnerInfoEntry {
  const trimmed = reply.trim();
  if (isInfraConfigUnsupportedReply(trimmed)) return { status: 'unsupported', fetchedAt };
  if (!trimmed.startsWith('>')) return { status: 'error', fetchedAt, reason: 'invalid-reply' };
  const text = trimmed.startsWith('> ') ? trimmed.slice(2) : trimmed.slice(1);
  return text.trim() ? { status: 'ok', text, fetchedAt } : { status: 'empty', fetchedAt };
}

/** `|` and stray newlines both become line breaks; interior blanks are kept. */
export function meshcoreOwnerInfoLines(text: string): string[] {
  const lines = text.split(/\||\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1]?.trim() === '') lines.pop();
  return lines;
}

export interface ReadMeshcoreOwnerInfoDeps {
  hwModel: string | undefined;
  /** False → return `needs-password` WITHOUT calling `send`. */
  hasAdminPassword: boolean;
  send: (command: string) => Promise<string>;
}

export async function readMeshcoreOwnerInfo(
  deps: ReadMeshcoreOwnerInfoDeps,
): Promise<MeshcoreOwnerInfoEntry> {
  const fetchedAt = Date.now();
  if (!meshcoreOwnerInfoSupported(deps.hwModel)) {
    return { status: 'unsupported', fetchedAt };
  }
  if (!deps.hasAdminPassword) return { status: 'needs-password', fetchedAt };
  try {
    return parseMeshcoreOwnerInfoReply(await deps.send('get owner.info'), fetchedAt);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const reason = /auth/i.test(message)
      ? 'auth'
      : /timeout|timed out/i.test(message)
        ? 'timeout'
        : 'failed';
    console.debug('[meshcoreOwnerInfo] read failed ' + message);
    return { status: 'error', fetchedAt, reason };
  }
}
