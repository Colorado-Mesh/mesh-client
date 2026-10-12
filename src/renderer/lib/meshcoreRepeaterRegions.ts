import { serializeMeshcoreUserMessage } from './meshcore/meshcoreMessageI18n';
import type { InfraConfigIsCurrent, InfraConfigSend } from './meshcoreInfraConfig';

export interface MeshcoreRepeaterRegion {
  name: string;
  depth: number;
  home: boolean;
  floodAllowed: boolean;
}

export interface MeshcoreRepeaterRegions {
  entries: MeshcoreRepeaterRegion[];
  truncated: boolean;
}

function regionError(key: string): Error {
  return new Error(serializeMeshcoreUserMessage({ key }));
}

/** CommonCLI `region` exports an indented tree into a 160-byte buffer, including NUL. */
export function parseMeshcoreRepeaterRegions(response: string): MeshcoreRepeaterRegions {
  if (
    /^(?:unknown|\?\?:|err - \?\?|error[: ,]+(?:unsupported|region commands not implemented))/i.test(
      response.trim(),
    )
  )
    throw regionError('infraConfig.regionsUnavailable');
  if (/^err(?:or)?\b/i.test(response.trim())) throw regionError('infraConfig.commandRejected');

  const truncated = new TextEncoder().encode(response).length >= 159;
  const lines = response.replace(/\r\n/g, '\n').split('\n');
  // A full buffer can end halfway through a name or its F flag. Never render that as a region.
  if (truncated && !response.endsWith('\n')) lines.pop();
  const entries: MeshcoreRepeaterRegion[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const match = /^( *)(\S+?)(\^)?(?: (F))?$/.exec(line);
    if (!match || /\p{Cc}/u.test(match[2])) throw regionError('infraConfig.invalidReply');
    const depth = match[1].length;
    const previous = entries.at(-1);
    if (
      (!previous && (match[2] !== '*' || depth !== 0)) ||
      (previous && (depth === 0 || depth > previous.depth + 1 || match[2] === '*'))
    )
      throw regionError('infraConfig.invalidReply');
    entries.push({
      name: match[2],
      depth,
      home: Boolean(match[3]),
      floodAllowed: match[4] === 'F',
    });
  }
  if (!entries.length) throw regionError('infraConfig.regionsUnavailable');
  return { entries, truncated };
}

export async function readMeshcoreRepeaterRegions(
  send: InfraConfigSend,
  isCurrent: InfraConfigIsCurrent,
): Promise<MeshcoreRepeaterRegions> {
  if (!isCurrent()) throw regionError('infraConfig.sessionChanged');
  // `region list` is serial-only on older releases. Bare `region` supports remote reads in 1.12+.
  const response = await send('region', isCurrent);
  if (!isCurrent()) throw regionError('infraConfig.sessionChanged');
  return parseMeshcoreRepeaterRegions(response);
}
