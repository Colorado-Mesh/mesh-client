import { describe, expect, it } from 'vitest';

import { meshNodeStubForDetailModal } from './meshNodeStubForDetail';

describe('meshNodeStubForDetailModal', () => {
  it('creates stub with expected defaults', () => {
    const node = meshNodeStubForDetailModal(42);
    expect(node.node_id).toBe(42);
    expect(node.long_name).toBe('Node-2A');
    expect(node.short_name).toBe('');
    expect(node.hw_model).toBe('Unknown');
    expect(node.battery).toBe(0);
    expect(node.snr).toBe(0);
    expect(node.last_heard).toBe(0);
    expect(node.latitude).toBeNull();
    expect(node.longitude).toBeNull();
  });

  it('correctly formats hex for node IDs with different widths', () => {
    expect(meshNodeStubForDetailModal(1).long_name).toBe('Node-1');
    expect(meshNodeStubForDetailModal(255).long_name).toBe('Node-FF');
    expect(meshNodeStubForDetailModal(1024).long_name).toBe('Node-400');
  });
});
