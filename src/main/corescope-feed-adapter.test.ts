// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import {
  coreScopeObserverRegions,
  coreScopePacket,
  readCoreScopeSnapshot,
} from './corescope-feed-adapter';

const request = {
  baseUrl: 'https://analyzer.bostonme.sh',
  provider: 'corescope' as const,
  region: 'BOS',
};

function reader() {
  return vi.fn((path: string): Promise<unknown> =>
    Promise.resolve(
      path.startsWith('/api/nodes')
        ? { nodes: [{ public_key: 'ab' }], has_more: false }
        : path === '/api/observers'
          ? { observers: [{ id: 'AA', iata: 'BOS' }] }
          : { BOS: 'Boston, MA', CON: 'Concord, NH' },
    ),
  );
}

describe('CoreScope public feed adapter', () => {
  it('reads only public directories, preserving node data and exact IATA region codes', async () => {
    const read = reader();
    const result = await readCoreScopeSnapshot(request, read);
    expect(read.mock.calls.map(([path]) => path)).toEqual([
      '/api/nodes?limit=500&offset=0',
      '/api/observers',
      '/api/config/regions',
    ]);
    expect(result).toEqual({
      type: 'snapshot',
      provider: 'corescope',
      nodes: [{ public_key: 'ab' }],
      observers: [{ id: 'AA', iata: 'BOS' }],
      regions: [
        { slug: 'BOS', name: 'Boston, MA' },
        { slug: 'CON', name: 'Concord, NH' },
      ],
      messages: [],
    });
  });

  it('bounds old servers with missing has_more and never assumes a short page means complete', async () => {
    const read = reader();
    read.mockImplementation((path) =>
      Promise.resolve(
        path.startsWith('/api/nodes')
          ? { nodes: [{ public_key: path }] }
          : path === '/api/observers'
            ? { observers: [] }
            : { BOS: 'Boston' },
      ),
    );
    const result = await readCoreScopeSnapshot(request, read);
    expect(result.nodes).toHaveLength(10);
    expect(result.directoryLimited).toBe(true);
    expect(read.mock.calls.filter(([path]) => path.startsWith('/api/nodes'))).toHaveLength(10);
    expect(read).toHaveBeenCalledWith('/api/nodes?limit=500&offset=4500');
  });

  it('continues past empty filtered pages when the server explicitly reports more nodes', async () => {
    const read = reader();
    read.mockImplementation((path) =>
      Promise.resolve(
        path.startsWith('/api/nodes')
          ? path.includes('offset=0')
            ? { nodes: [], has_more: true }
            : { nodes: [{ public_key: 'later-visible-node' }], has_more: false }
          : path === '/api/observers'
            ? { observers: [] }
            : { BOS: 'Boston' },
      ),
    );
    const result = await readCoreScopeSnapshot(request, read);
    expect(result.nodes).toEqual([{ public_key: 'later-visible-node' }]);
    expect(result.directoryLimited).toBeUndefined();
    expect(read).toHaveBeenCalledWith('/api/nodes?limit=500&offset=500');
    expect(read.mock.calls.filter(([path]) => path.startsWith('/api/nodes'))).toHaveLength(2);
  });

  it('bounds an endless run of empty pages that report more nodes', async () => {
    const read = reader();
    read.mockImplementation((path) =>
      Promise.resolve(
        path.startsWith('/api/nodes')
          ? { nodes: [], has_more: true }
          : path === '/api/observers'
            ? { observers: [] }
            : { BOS: 'Boston' },
      ),
    );
    const result = await readCoreScopeSnapshot(request, read);
    expect(result.nodes).toEqual([]);
    expect(result.directoryLimited).toBe(true);
    expect(read.mock.calls.filter(([path]) => path.startsWith('/api/nodes'))).toHaveLength(10);
    expect(read).toHaveBeenCalledWith('/api/nodes?limit=500&offset=4500');
  });

  it('caps the global directory at 5000 nodes and the observer roster at 1000', async () => {
    const read = reader();
    read.mockImplementation((path) =>
      Promise.resolve(
        path.startsWith('/api/nodes')
          ? { nodes: Array.from({ length: 600 }, (_, id) => ({ id })), has_more: true }
          : path === '/api/observers'
            ? { observers: Array.from({ length: 1100 }, (_, id) => ({ id })) }
            : { BOS: 'Boston' },
      ),
    );
    const result = await readCoreScopeSnapshot(request, read);
    expect(result.nodes).toHaveLength(5000);
    expect(result.observers).toHaveLength(1000);
    expect(result.directoryLimited).toBe(true);
  });

  it('rejects unknown regions and invalid directory responses', async () => {
    await expect(readCoreScopeSnapshot({ ...request, region: 'bos' }, reader())).rejects.toThrow(
      'selected region',
    );
    await expect(readCoreScopeSnapshot(request, vi.fn().mockResolvedValue(null))).rejects.toThrow(
      'invalid directory',
    );
  });

  it('filters by exact observer membership and rejects missing or conflicting membership', () => {
    const regions = coreScopeObserverRegions([
      { id: 'AA', iata: 'BOS' },
      { id: 'BB', iata: 'CON' },
      { id: 'CC', iata: 'BOS' },
      { id: 'cc', iata: 'CON' },
    ]);
    const packet = { observer_id: 'aa', hash: '1234', decoded_json: '{"text":"public"}' };
    expect(coreScopePacket({ type: 'packet', data: packet }, 'BOS', regions)).toEqual(packet);
    expect(coreScopePacket({ type: 'packet', data: packet }, 'CON', regions)).toBeNull();
    expect(
      coreScopePacket({ type: 'packet', data: { observer_id: 'missing' } }, 'BOS', regions),
    ).toBeNull();
    expect(
      coreScopePacket({ type: 'packet', data: { observer_id: 'CC' } }, 'BOS', regions),
    ).toBeNull();
    expect(coreScopePacket({ type: 'packet', data: packet }, undefined, regions)).toEqual(packet);
    expect(
      coreScopePacket({ type: 'packet', data: { observer_iata: 'BOS' } }, 'BOS', regions),
    ).toEqual({ observer_iata: 'BOS' });
  });

  it('ignores heartbeats, unexpected events, and malformed or oversized packet fields', () => {
    expect(coreScopePacket({ type: 'heartbeat' }, undefined, new Map())).toBeNull();
    expect(coreScopePacket({ type: 'packet', data: null }, undefined, new Map())).toBeNull();
    expect(
      coreScopePacket(
        { type: 'packet', data: { raw_hex: 'a'.repeat(65_537) } },
        undefined,
        new Map(),
      ),
    ).toBeNull();
  });
});
