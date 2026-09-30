import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatMeshtasticNodeId } from '@/shared/nodeNameUtils';

import type { RfDuplicateOriginator } from '../lib/diagnostics/meshCongestionAttribution';
import type { MeshNode } from '../lib/types';
import MeshCongestionAttributionBlock from './MeshCongestionAttributionBlock';

const NAMED_ID = 0x192ea6ac;
const UNNAMED_ID = 0xd16fe984;

const namedNode: MeshNode = {
  node_id: NAMED_ID,
  long_name: 'KR4GTA-ETSU-Repeater',
  short_name: 'KR',
  hw_model: '',
  snr: 0,
  battery: 0,
  last_heard: Date.now(),
  latitude: null,
  longitude: null,
};

const originators: RfDuplicateOriginator[] = [
  { nodeId: NAMED_ID, echoScore: 2, recordCount: 3 },
  { nodeId: UNNAMED_ID, echoScore: 1, recordCount: 2 },
];

const nodes = new Map<number, MeshNode>([[NAMED_ID, namedNode]]);

describe('MeshCongestionAttributionBlock originator labels', () => {
  it('uses long name and never !hex when showNodeHexId is false', () => {
    render(
      <MeshCongestionAttributionBlock
        lines={[]}
        originators={originators}
        nodes={nodes}
        showNodeHexId={false}
      />,
    );

    expect(screen.getByText('KR4GTA-ETSU-Repeater')).toBeInTheDocument();
    expect(screen.getByText('Unknown node')).toBeInTheDocument();
    expect(screen.queryByText(/^![0-9a-f]{8}$/)).not.toBeInTheDocument();
  });

  it('keeps short name and !hex fallback by default (Meshtastic)', () => {
    render(<MeshCongestionAttributionBlock lines={[]} originators={originators} nodes={nodes} />);

    expect(screen.getByText('KR')).toBeInTheDocument();
    expect(screen.getByText(formatMeshtasticNodeId(UNNAMED_ID))).toBeInTheDocument();
  });
});
