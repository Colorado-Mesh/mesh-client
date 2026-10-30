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

  describe('secret reply history', () => {
    it('redacts replies after completion and after timeout', async () => {
      const completed = service.registerPendingCommand('get guest.password', [], { token: 'AB' });
      service.handleResponse('AB|> secret');
      expect(await completed.promise).toBe('> secret');
      expect(service.redactResponseForHistory('AB|> secret')).toBe('[redacted]');

      vi.useFakeTimers();
      try {
        const timedOut = service.registerPendingCommand('get prv.key', [], {
          token: 'CD',
          timeoutMs: 10,
        });
        const rejected = expect(timedOut.promise).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(10);
        await rejected;
        expect(service.redactResponseForHistory('CD|> private-secret')).toBe('[redacted]');
        service.clear();
        expect(service.redactResponseForHistory('CD|> private-secret')).toBe('[redacted]');
      } finally {
        vi.useRealTimers();
      }
    });

    it('redacts password-change echoes without a token and retains ordinary replies', () => {
      expect(service.redactResponseForHistory('password now: secret')).toBe('[redacted]');
      expect(service.redactResponseForHistory('EF|> Repeater')).toBe('> Repeater');
      expect(service.redactResponseForHistory('EF|> wifi.pwd = secret')).toBe(
        '> wifi.pwd: [redacted]',
      );
    });
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
    it('preserves multiline replies and matches only the leading token', () => {
      const body = '*^ F\r\n us F\r\n  us-tn F\r\n';
      expect(service.parseResponseToken(`AB|${body}`)).toEqual({ token: 'AB', body });
      expect(service.parseResponseToken('\nAB|OK').token).toBeNull();
    });

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
      expect(timeout).toBe(30000);
    });

    it('should cap hop-scaled timeout at 120s', () => {
      const timeoutWithHops = service.calculateTimeout(
        Array.from({ length: 46 }, () => new Uint8Array(32)),
      );
      expect(timeoutWithHops).toBe(120_000);
    });

    it('should include message size in dynamic timeout below cap', () => {
      const smallTimeout = service.calculateTimeout([], 100);
      const largeTimeout = service.calculateTimeout([], 100000);
      expect(smallTimeout).toBe(30100);
      expect(largeTimeout).toBe(120_000);
    });
  });

  describe('calculateRepeaterCliTimeout', () => {
    it('scales with hop count and caps at 120s', async () => {
      const { calculateRepeaterCliTimeout } = await import('./repeaterCommandService');
      expect(calculateRepeaterCliTimeout(0)).toBe(30_000);
      expect(calculateRepeaterCliTimeout(3)).toBe(36_000);
      expect(calculateRepeaterCliTimeout(50)).toBe(120_000);
    });
  });

  describe('padRepeaterCliTimeoutForWaitingDrain', () => {
    it('leaves timeout unchanged when drain is idle', async () => {
      const { padRepeaterCliTimeoutForWaitingDrain } = await import('./repeaterCommandService');
      expect(padRepeaterCliTimeoutForWaitingDrain(30_000, false, 45_000)).toBe(30_000);
    });

    it('pads timeout and caps at max when drain is busy', async () => {
      const { padRepeaterCliTimeoutForWaitingDrain, REPEATER_CLI_MAX_TIMEOUT_MS } =
        await import('./repeaterCommandService');
      expect(padRepeaterCliTimeoutForWaitingDrain(30_000, true, 45_000)).toBe(75_000);
      expect(padRepeaterCliTimeoutForWaitingDrain(100_000, true, 45_000)).toBe(
        REPEATER_CLI_MAX_TIMEOUT_MS,
      );
    });
  });

  describe('computeRepeaterCliHopCount', () => {
    it('prefers trace hop count over hopsAway', async () => {
      const { computeRepeaterCliHopCount } = await import('./repeaterCommandService');
      expect(computeRepeaterCliHopCount(2, 1)).toBe(1);
      expect(computeRepeaterCliHopCount(null, 3)).toBe(3);
      expect(computeRepeaterCliHopCount(2, null)).toBe(2);
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
      const { token, promise } = service.registerPendingCommand('test', [pubKey], {
        senderNodeId: 42,
      });

      const handled = service.handleResponse(`${token}|OK`, 42);
      expect(handled).toBe(true);

      const response = await promise;
      expect(response).toBe('OK');
    });

    it('rejects response when sender node id does not match', () => {
      const { token } = service.registerPendingCommand('cmd', [], { senderNodeId: 42 });
      const handled = service.handleResponse(`${token}|OK`, 99);
      expect(handled).toBe(false);
      expect(service.hasPendingCommand(token)).toBe(true);
    });

    it('still matches when sender id is unknown (0) and only one pending', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', [], { senderNodeId: 42 });
      service.handleResponse(`${token}|OK`, 0);
      await expect(promise).resolves.toBe('OK');
    });

    it('matches by token when sender id is 0 and multiple pending', async () => {
      const first = service.registerPendingCommand('cmd1', [], { senderNodeId: 42 });
      const second = service.registerPendingCommand('cmd2', [], { senderNodeId: 43 });
      second.promise.catch(() => {});

      const handled = service.handleResponse(`${first.token}|OK`, 0);
      expect(handled).toBe(true);
      await expect(first.promise).resolves.toBe('OK');
      expect(service.hasPendingCommand(second.token)).toBe(true);
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

  describe('ingestResponse', () => {
    it('returns resolved with historyText and records a settled tombstone', async () => {
      const { token, promise } = service.registerPendingCommand('uptime', [], {
        token: 'A1',
        senderNodeId: 0x1234,
      });
      const first = service.ingestResponse('A1|uptime 42', 0x1234);
      expect(first).toEqual({
        kind: 'resolved',
        nodeId: 0x1234,
        historyText: 'uptime 42',
      });
      await expect(promise).resolves.toBe('uptime 42');
      expect(service.hasPendingCommand(token)).toBe(false);
    });

    it('returns duplicate for an identical re-delivery of a settled frame', async () => {
      const { promise } = service.registerPendingCommand('name', [], {
        token: 'A1',
        senderNodeId: 0x1234,
      });
      expect(service.ingestResponse('A1|Unknown command', 0x1234).kind).toBe('resolved');
      await promise;
      expect(service.ingestResponse('A1|Unknown command', 0x1234)).toEqual({ kind: 'duplicate' });
    });

    it('returns unmatched when the same token has a different body', async () => {
      const { promise } = service.registerPendingCommand('cmd', [], {
        token: 'A1',
        senderNodeId: 0x1234,
      });
      expect(service.ingestResponse('A1|first', 0x1234).kind).toBe('resolved');
      await promise;
      expect(service.ingestResponse('A1|second', 0x1234)).toEqual({
        kind: 'unmatched',
        historyText: 'second',
      });
    });

    it('returns unmatched for a late reply after timeout', async () => {
      vi.useFakeTimers();
      try {
        const { promise } = service.registerPendingCommand('cmd', [], {
          token: 'A1',
          senderNodeId: 0x1234,
          timeoutMs: 10,
        });
        const rejected = expect(promise).rejects.toThrow('timed out');
        await vi.advanceTimersByTimeAsync(10);
        await rejected;
        expect(service.ingestResponse('A1|late', 0x1234)).toEqual({
          kind: 'unmatched',
          historyText: 'late',
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('clears the settled tombstone when the token is reused', async () => {
      const first = service.registerPendingCommand('cmd', [], {
        token: 'A1',
        senderNodeId: 0x1234,
      });
      expect(service.ingestResponse('A1|one', 0x1234).kind).toBe('resolved');
      await first.promise;
      expect(service.ingestResponse('A1|one', 0x1234).kind).toBe('duplicate');

      const second = service.registerPendingCommand('cmd2', [], {
        token: 'A1',
        senderNodeId: 0x1234,
      });
      expect(service.ingestResponse('A1|one', 0x1234)).toEqual({
        kind: 'resolved',
        nodeId: 0x1234,
        historyText: 'one',
      });
      await second.promise;
    });

    it('drops settled tombstones on clear()', async () => {
      const { promise } = service.registerPendingCommand('cmd', [], {
        token: 'A1',
        senderNodeId: 0x1234,
      });
      expect(service.ingestResponse('A1|ok', 0x1234).kind).toBe('resolved');
      await promise;
      service.clear();
      expect(service.ingestResponse('A1|ok', 0x1234)).toEqual({
        kind: 'unmatched',
        historyText: 'ok',
      });
    });

    it('does not treat a sender mismatch as a duplicate', async () => {
      const { promise } = service.registerPendingCommand('cmd', [], {
        token: 'A1',
        senderNodeId: 0x1234,
      });
      expect(service.ingestResponse('A1|ok', 0x1234).kind).toBe('resolved');
      await promise;
      expect(service.ingestResponse('A1|ok', 0x5678)).toEqual({
        kind: 'unmatched',
        historyText: 'ok',
      });
    });

    it('redacts historyText for secret commands', async () => {
      const { promise } = service.registerPendingCommand('get guest.password', [], {
        token: 'AB',
        senderNodeId: 1,
      });
      expect(service.ingestResponse('AB|> secret', 1)).toEqual({
        kind: 'resolved',
        nodeId: 1,
        historyText: '[redacted]',
      });
      await promise;
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

    it('rejectPending removes the token without retry', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', [], { maxRetries: 3 });
      promise.catch(() => {});
      expect(service.rejectPending(token, new Error('send failed'))).toBe(true);
      expect(service.hasPendingCommand(token)).toBe(false);
      await expect(promise).rejects.toThrow('send failed');
      expect(service.rejectPending(token, new Error('again'))).toBe(false);
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

    it('extendPendingTimeout lengthens an in-flight wait', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', [], { timeoutMs: 1000 });
      promise.catch(() => {});
      service.extendPendingTimeout(token, 3000);
      vi.advanceTimersByTime(1500);
      expect(service.hasPendingCommand(token)).toBe(true);
      vi.advanceTimersByTime(1600);
      await expect(promise).rejects.toThrow('CLI command timed out after 3000ms');
    });

    it.each([-3_600_000, 3_600_000])(
      'keeps the extended CLI reply deadline when the wall clock changes by %s ms',
      async (clockChange) => {
        const { token, promise } = service.registerPendingCommand('cmd', [], { timeoutMs: 1000 });
        const rejected = expect(promise).rejects.toThrow('CLI command timed out after 3000ms');
        vi.advanceTimersByTime(500);
        vi.setSystemTime(Date.now() + clockChange);
        service.extendPendingTimeout(token, 3000);
        await vi.advanceTimersByTimeAsync(2499);
        expect(service.hasPendingCommand(token)).toBe(true);
        await vi.advanceTimersByTimeAsync(1);
        await rejected;
      },
    );

    it('restartPendingTimeoutFromNow resets the reply window after a delayed send', async () => {
      const { token, promise } = service.registerPendingCommand('cmd', [], { timeoutMs: 1000 });
      promise.catch(() => {});
      vi.advanceTimersByTime(800);
      service.restartPendingTimeoutFromNow(token, 2000);
      vi.advanceTimersByTime(1500);
      expect(service.hasPendingCommand(token)).toBe(true);
      vi.advanceTimersByTime(600);
      await expect(promise).rejects.toThrow('CLI command timed out after 2000ms');
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
