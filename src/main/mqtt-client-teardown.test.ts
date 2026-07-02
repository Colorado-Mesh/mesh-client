import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';

import { attachMqttClientErrorSink, forceEndMqttClient } from './mqtt-client-teardown';

describe('mqtt-client-teardown', () => {
  it('attachMqttClientErrorSink absorbs late error events', () => {
    const client = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> };
    client.end = vi.fn();
    attachMqttClientErrorSink(client as never);
    expect(() => {
      client.emit('error', new Error('connack timeout'));
    }).not.toThrow();
  });

  it('forceEndMqttClient ends client and absorbs post-end errors', () => {
    const client = new EventEmitter() as EventEmitter & { end: ReturnType<typeof vi.fn> };
    client.end = vi.fn();
    forceEndMqttClient(client as never);
    expect(client.end).toHaveBeenCalledWith(true);
    expect(() => {
      client.emit('error', new Error('connack timeout'));
    }).not.toThrow();
  });
});
