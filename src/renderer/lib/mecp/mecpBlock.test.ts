import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => data.set(k, v),
    removeItem: (k: string) => data.delete(k),
    clear: () => {
      data.clear();
    },
  });
});

import { tryParseMecp } from '@/renderer/lib/mecp/mecpMessages';
import { useIncidentStore } from '@/renderer/stores/incidentStore';
import { isMecpSenderBlocked, useMecpBlockStore } from '@/renderer/stores/mecpBlockStore';

import { blockMecpIncidentSender } from './mecpBlock';

function ingest(
  text: string,
  senderId: string,
  protocol: 'meshtastic' | 'meshcore' = 'meshtastic',
) {
  const id = useIncidentStore.getState().upsertFromMecp({
    protocol,
    parsed: tryParseMecp(text)!,
    senderId,
    senderName: `node-${senderId}`,
    receivedAt: Date.now(),
  })!;
  return useIncidentStore.getState().incidents[id];
}

describe('blockMecpIncidentSender', () => {
  beforeEach(() => {
    useIncidentStore.getState().clearAll();
    useMecpBlockStore.setState({ blocked: {} });
  });

  it('blocks the sender on the origin protocol without touching incidents by default', () => {
    const inc = ingest('MECP/0/M01 one', '9');
    expect(blockMecpIncidentSender(inc)).toBe(0);
    expect(isMecpSenderBlocked('meshtastic', '9')).toBe(true);
    expect(useMecpBlockStore.getState().blocked['meshtastic:9'].label).toBe('node-9');
    expect(useIncidentStore.getState().incidents[inc.id].status).toBe('open');
  });

  it("resolves only that sender's open incidents on the same protocol", () => {
    const a = ingest('MECP/0/M01 one', '9');
    const b = ingest('MECP/1/T04 two', '9');
    const other = ingest('MECP/0/M01 three', '10');
    const otherProto = ingest('MECP/0/M01 four', '9', 'meshcore');

    expect(blockMecpIncidentSender(a, { resolveOpen: true })).toBe(2);
    const incidents = useIncidentStore.getState().incidents;
    expect(incidents[a.id].status).toBe('resolved');
    expect(incidents[b.id].status).toBe('resolved');
    expect(incidents[other.id].status).toBe('open');
    expect(incidents[otherProto.id].status).toBe('open');
  });
});
