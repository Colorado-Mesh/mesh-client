import { useTranslation } from 'react-i18next';

import { nodeDisplayName } from '../lib/nodeLongNameOrHex';
import type { MeshNode, MeshProtocol } from '../lib/types';

export interface MentionCandidate {
  nodeId: number;
  name: string;
}

interface Props {
  candidates: MentionCandidate[];
  selectedIdx: number;
  onSelect: (name: string) => void;
  onSetSelectedIdx: (idx: number) => void;
}

export default function MentionAutocomplete({
  candidates,
  selectedIdx,
  onSelect,
  onSetSelectedIdx,
}: Props) {
  const { t } = useTranslation();
  if (candidates.length === 0) return null;

  return (
    <div
      className="absolute bottom-full left-0 z-50 mb-1 max-h-48 w-64 overflow-y-auto rounded-lg border border-gray-600 bg-slate-800 shadow-lg"
      role="listbox"
      aria-label={t('chatPanel.mentionSuggestionsAria')}
    >
      {candidates.map((c, i) => (
        <button
          key={c.nodeId}
          type="button"
          role="option"
          aria-selected={i === selectedIdx}
          onMouseEnter={() => {
            onSetSelectedIdx(i);
          }}
          onClick={() => {
            onSelect(c.name);
          }}
          className={`w-full px-3 py-1.5 text-left text-sm ${
            i === selectedIdx ? 'bg-slate-700 text-white' : 'text-gray-300 hover:bg-slate-700'
          }`}
        >
          @{c.name}
        </button>
      ))}
    </div>
  );
}

/** Build the mention candidate list from the nodes map. */
export function buildMentionCandidates(
  nodes: Map<number, MeshNode>,
  protocol: MeshProtocol,
  query: string,
): MentionCandidate[] {
  const q = query.toLowerCase();
  const results: MentionCandidate[] = [];
  for (const [nodeId, node] of nodes) {
    const name = nodeDisplayName(node, protocol);
    if (name?.toLowerCase().startsWith(q)) {
      results.push({ nodeId, name });
    }
  }
  return results.slice(0, 6);
}
