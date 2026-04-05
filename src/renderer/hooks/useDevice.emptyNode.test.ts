import { describe, expect, it } from 'vitest';

import { createChatStubNode, emptyNode } from './useDevice';

describe('emptyNode', () => {
  it('generates an empty long_name until identity is received from the mesh', () => {
    const node = emptyNode(0xabcd1234);
    expect(node.long_name).toBe('');
  });

  it('uses an empty short_name until identity is received from the mesh', () => {
    const node = emptyNode(0xabcd1234);
    expect(node.short_name).toBe('');
  });

  it('handles the minimum node ID', () => {
    const node = emptyNode(0x0000007f);
    expect(node.long_name).toBe('');
    expect(node.short_name).toBe('');
  });

  it('handles the maximum 32-bit node ID', () => {
    const node = emptyNode(0xffffffff);
    expect(node.long_name).toBe('');
    expect(node.short_name).toBe('');
  });

  it('sets node_id correctly', () => {
    const node = emptyNode(0x12345678);
    expect(node.node_id).toBe(0x12345678);
  });

  it('initializes numeric fields to zero and coordinates to null', () => {
    const node = emptyNode(0x1);
    expect(node.snr).toBe(0);
    expect(node.battery).toBe(0);
    expect(node.last_heard).toBe(0);
    expect(node.latitude).toBe(null);
    expect(node.longitude).toBe(null);
  });

  it('produces identical empty long names for different node IDs', () => {
    const a = emptyNode(0xaaaaaaaa);
    const b = emptyNode(0xbbbbbbbb);
    expect(a.long_name).toBe('');
    expect(a.short_name).toBe('');
    expect(b.short_name).toBe('');
  });

  it('chat stub nodes use empty long_name and short_name', () => {
    const nodeId = 0x6985e7fc;
    const stub = createChatStubNode(nodeId, 'rf');
    expect(stub.long_name).toBe('');
    expect(stub.short_name).toBe('');
  });

  it('chat stub nodes mark mqtt-only source correctly', () => {
    const nodeId = 0x12345678;
    const rfStub = createChatStubNode(nodeId, 'rf');
    const mqttStub = createChatStubNode(nodeId, 'mqtt');

    expect(rfStub.source).toBe('rf');
    expect(rfStub.heard_via_mqtt_only).toBe(false);

    expect(mqttStub.source).toBe('mqtt');
    expect(mqttStub.heard_via_mqtt_only).toBe(true);
  });
});
