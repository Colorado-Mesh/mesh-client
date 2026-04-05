import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type CliHistoryEntry,
  createRepeaterCommandService,
  type RepeaterCommandService,
} from './repeaterCommandService';

describe('RepeaterCommandService', () => {
  let service: RepeaterCommandService;

  beforeEach(() => {
    service = createRepeaterCommandService();
  });

  describe('generateToken', () => {
    it('should generate sequential tokens cycling through 0-255', () => {
      const tokens: string[] = [];
      for (let i = 0; i < 260; i++) {
        tokens.push(service.generateToken());
      }
      expect(tokens[0]).toBe('00');
      expect(tokens[1]).toBe('01');
      expect(tokens[255]).toBe('FF');
      expect(tokens[256]).toBe('00');
      expect(tokens[259]).toBe('03');
    });

    it('should generate uppercase hex tokens', () => {
      const token = service.generateToken();
      expect(token).toMatch(/^[0-9A-F]{2}$/);
    });
  });

  describe('formatCommandWithToken', () => {
    it('should prepend token to command with pipe delimiter', () => {
      const result = service.formatCommandWithToken('name', 'AB');
      expect(result).toBe('AB|name');
    });

    it('should generate token if not provided', () => {
      const result = service.formatCommandWithToken('radio');
      expect(result).toMatch(/^[0-9A-F]{2}\|radio$/);
    });
  });

  describe('parseResponseToken', () => {
    it('should parse token and body from response', () => {
      const result = service.parseResponseToken('AB|response text');
      expect(result.token).toBe('AB');
      expect(result.body).toBe('response text');
    });

    it('should handle lowercase token', () => {
      const result = service.parseResponseToken('ab|response');
      expect(result.token).toBe('AB');
      expect(result.body).toBe('response');
    });

    it('should return null token for responses without token', () => {
      const result = service.parseResponseToken('no token here');
      expect(result.token).toBeNull();
      expect(result.body).toBe('no token here');
    });

    it('should handle empty body', () => {
      const result = service.parseResponseToken('CD|');
      expect(result.token).toBe('CD');
      expect(result.body).toBe('');
    });
  });

  describe('calculateTimeout', () => {
    it('should return minimum timeout for empty path and small message', () => {
      const timeout = service.calculateTimeout([]);
      expect(timeout).toBe(10000);
    });

    it('should return dynamic timeout when it exceeds minimum', () => {
      const timeoutWithHops = service.calculateTimeout([
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
        new Uint8Array(32),
      ]); // 17 hops = 2000 + 17*500 = 10500
      expect(timeoutWithHops).toBe(10500);
    });

    it('should include message size in dynamic timeout', () => {
      const smallTimeout = service.calculateTimeout([], 100); // 2000 + 100 = 2100-> not enough to exceed 10000
      const largeTimeout = service.calculateTimeout([], 100000); // 2000 + 100000 = 102000
      expect(smallTimeout).toBe(10000);
      expect(largeTimeout).toBe(102000);
    });
  });

  describe('registerPendingCommand', () => {
    it('should register a pending command and return token and promise', () => {
      const pubKey = new Uint8Array(32);
      const { token, promise } = service.registerPendingCommand('name', [pubKey]);

      expect(token).toMatch(/^[0-9A-F]{2}$/);
      expect(promise).toBeInstanceOf(Promise);
      expect(service.hasPendingCommand(token)).toBe(true);
    });

    it('should allow custom timeout', () => {
      const { token } = service.registerPendingCommand('name', [], {
        timeoutMs: 5000,
      });
      const pending = service.getPendingCommand(token);
      expect(pending?.timeoutMs).toBe(5000);
    });

    it('should allow custom max retries', () => {
      const { token } = service.registerPendingCommand('name', [], {
        maxRetries: 10,
      });
      const pending = service.getPendingCommand(token);
      expect(pending?.maxRetries).toBe(10);
    });
  });

  describe('handleResponse', () => {
    it('should resolve pending command when response token matches', async () => {
      const pubKey = new Uint8Array(32);
      const { token, promise } = service.registerPendingCommand('test', [pubKey]);

      const handled = service.handleResponse(`${token}|OK`);
      expect(handled).toBe(true);

      const response = await promise;
      expect(response).toBe('OK');
    });

    it('should strip token from response body', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', []);

      service.handleResponse(`${token}|response with spaces`);
      const response = await promise;
      expect(response).toBe('response with spaces');
    });

    it('should return false for non-matching token', () => {
      service.registerPendingCommand('cmd', []);
      const handled = service.handleResponse('99|response');
      expect(handled).toBe(false);
    });

    it('should return false for response without token', () => {
      service.registerPendingCommand('cmd', []);
      const handled = service.handleResponse('no token');
      expect(handled).toBe(false);
    });

    it('should remove pending command after resolution', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', []);

      service.handleResponse(`${token}|done`);
      await promise;

      expect(service.hasPendingCommand(token)).toBe(false);
    });
  });

  describe('clear', () => {
    it('should reject all pending commands', () => {
      const { promise: p1 } = service.registerPendingCommand('cmd1', []);
      const { promise: p2 } = service.registerPendingCommand('cmd2', []);
      // Suppress unhandled rejection warnings
      p1.catch(() => {});
      p2.catch(() => {});

      service.clear();

      expect(service.hasPendingCommand('00')).toBe(false);
      expect(service.hasPendingCommand('01')).toBe(false);
    });

    it('should reject pending commands with error', async () => {
      const { promise } = service.registerPendingCommand('cmd', []);
      // Suppress unhandled rejection warning
      promise.catch(() => {});
      service.clear();
      await expect(promise).rejects.toThrow('CLI command cancelled');
    });
  });

  describe('handleError', () => {
    it('should increment retry count and return false when under maxRetries', () => {
      const { token } = service.registerPendingCommand('cmd', [], { maxRetries: 3 });
      const rejected = service.handleError(token, new Error('nack'));
      expect(rejected).toBe(false);
      expect(service.getPendingCommand(token)?.retryCount).toBe(1);
    });

    it('should reject and remove pending command when maxRetries is reached', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', [], { maxRetries: 2 });
      promise.catch(() => {});

      service.handleError(token, new Error('nack'));
      expect(service.hasPendingCommand(token)).toBe(true);

      const rejected = service.handleError(token, new Error('nack'));
      expect(rejected).toBe(true);
      expect(service.hasPendingCommand(token)).toBe(false);
      await expect(promise).rejects.toThrow('nack');
    });

    it('should return false for unknown token', () => {
      const rejected = service.handleError('FF', new Error('nack'));
      expect(rejected).toBe(false);
    });
  });

  describe('internal timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should auto-reject promise after timeoutMs', async () => {
      const { promise } = service.registerPendingCommand('cmd', [], { timeoutMs: 1000 });
      promise.catch(() => {});

      vi.advanceTimersByTime(1001);
      await expect(promise).rejects.toThrow('CLI command timed out after 1000ms');
    });

    it('should not fire timeout after handleResponse resolves the command', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', [], { timeoutMs: 1000 });
      service.handleResponse(`${token}|ok`);
      await promise;

      // Advancing past timeout should not throw a second time
      vi.advanceTimersByTime(2000);
      // promise is already resolved — no additional rejection
      await expect(promise).resolves.toBe('ok');
    });

    it('should cancel timer on clear()', async () => {
      const { promise } = service.registerPendingCommand('cmd', [], { timeoutMs: 1000 });
      promise.catch(() => {});
      service.clear();

      // Advancing past timeout should not cause a second rejection
      vi.advanceTimersByTime(2000);
      await expect(promise).rejects.toThrow('CLI command cancelled');
    });
  });
});

describe('CliHistoryEntry', () => {
  it('should define sent and received types', () => {
    const sentEntry: CliHistoryEntry = {
      type: 'sent',
      text: 'name',
      timestamp: Date.now(),
    };
    const receivedEntry: CliHistoryEntry = {
      type: 'received',
      text: 'MyRepeater',
      timestamp: Date.now(),
    };

    expect(sentEntry.type).toBe('sent');
    expect(receivedEntry.type).toBe('received');
  });
});
