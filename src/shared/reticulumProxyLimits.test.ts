import { describe, expect, it } from 'vitest';

import {
  RETICULUM_CONFIG_MAX_READ_BYTES,
  RETICULUM_PROXY_MAX_BODY_BYTES,
  RETICULUM_PROXY_MAX_RESPONSE_BYTES,
  RETICULUM_WS_MAX_MESSAGE_BYTES,
} from './reticulumProxyLimits';

describe('reticulumProxyLimits', () => {
  it('defines bounds for IPC proxy and sidecar HTTP/WS boundaries', () => {
    expect(RETICULUM_PROXY_MAX_BODY_BYTES).toBe(4 * 1024 * 1024);
    expect(RETICULUM_CONFIG_MAX_READ_BYTES).toBe(2 * 1024 * 1024);
    expect(RETICULUM_PROXY_MAX_RESPONSE_BYTES).toBe(16 * 1024 * 1024);
    expect(RETICULUM_WS_MAX_MESSAGE_BYTES).toBe(2 * 1024 * 1024);
  });
});
