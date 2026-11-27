// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  normalizeOptionalMeshcoreConnectionId,
  resolveMeshcoreConnectionId,
  resolveMeshcoreConnectTarget,
} from './meshcore-mqtt-connection-id';

describe('MeshCore MQTT connection ids', () => {
  it('normalizes supplied ids and treats blank as omitted', () => {
    expect(normalizeOptionalMeshcoreConnectionId('  feed-1  ', 'test')).toBe('feed-1');
    expect(normalizeOptionalMeshcoreConnectionId('   ', 'test')).toBeNull();
    expect(normalizeOptionalMeshcoreConnectionId(undefined, 'test')).toBeNull();
    expect(() => normalizeOptionalMeshcoreConnectionId(42, 'test')).toThrow(/must be a string/);
    expect(() => normalizeOptionalMeshcoreConnectionId('x'.repeat(65), 'test')).toThrow(/too long/);
  });

  it('defaults lookups to the chat broker', () => {
    expect(resolveMeshcoreConnectionId(undefined, 'test')).toBe('chat');
    expect(resolveMeshcoreConnectionId('feed-1', 'test')).toBe('feed-1');
  });

  it('keeps the legacy omitted-id chat connection', () => {
    expect(resolveMeshcoreConnectTarget(undefined, undefined)).toEqual({
      connectionId: 'chat',
      role: 'chat',
    });
    expect(resolveMeshcoreConnectTarget('  chat ', 'chat')).toEqual({
      connectionId: 'chat',
      role: 'chat',
    });
  });

  it('requires feed ids and chat ids to match their role', () => {
    expect(resolveMeshcoreConnectTarget('feed-1', 'feed')).toEqual({
      connectionId: 'feed-1',
      role: 'feed',
    });
    expect(() => resolveMeshcoreConnectTarget('chat', 'feed')).toThrow(/non-chat/);
    expect(() => resolveMeshcoreConnectTarget('feed-1', 'chat')).toThrow(/chat connectionId/);
  });
});
