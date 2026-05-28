import { Mesh } from '@meshtastic/protobufs';
import { describe, expect, it, vi } from 'vitest';

import {
  formatMeshtasticModuleApplyError,
  meshtasticRoutingErrorName,
  parseMeshtasticRoutingErrorCode,
} from './meshtasticApplyErrorMessage';

describe('meshtasticApplyErrorMessage', () => {
  const t = vi.fn((key: string, opts?: Record<string, unknown>) => {
    if (opts) return `${key}:${JSON.stringify(opts)}`;
    return key;
  });

  it('parses routing error code from SDK rejection object', () => {
    expect(parseMeshtasticRoutingErrorCode({ id: 48136936, error: 32 })).toBe(32);
  });

  it('maps BAD_REQUEST to modulePanel.errors.badRequest', () => {
    expect(
      formatMeshtasticModuleApplyError(
        { id: 1, error: Mesh.Routing_Error.BAD_REQUEST },
        t as never,
      ),
    ).toBe('modulePanel.errors.badRequest');
  });

  it('falls back to routingError with code and name for unknown codes', () => {
    const code = 99;
    expect(formatMeshtasticModuleApplyError({ error: code }, t as never)).toBe(
      `modulePanel.errors.routingError:${JSON.stringify({
        code,
        name: meshtasticRoutingErrorName(code),
      })}`,
    );
  });

  it('maps transport lost DOMException to transportLost key', () => {
    const err = new DOMException('Failed to write: The device has been lost.', 'NetworkError');
    expect(formatMeshtasticModuleApplyError(err, t as never)).toBe(
      'modulePanel.errors.transportLost',
    );
  });
});
