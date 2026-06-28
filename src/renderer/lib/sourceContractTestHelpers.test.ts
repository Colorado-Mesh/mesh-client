import { describe, expect, it } from 'vitest';

import {
  extractBalancedBlock,
  extractIfBlockBody,
  extractUseCallbackBody,
} from './sourceContractTestHelpers';

describe('sourceContractTestHelpers', () => {
  it('extractBalancedBlock returns inner text for nested braces', () => {
    const source = 'fn() { outer { inner { deep } } tail }';
    const openIndex = source.indexOf('{');
    expect(extractBalancedBlock(source, openIndex)).toBe(' outer { inner { deep } } tail ');
  });

  it('extractBalancedBlock throws on unbalanced input', () => {
    expect(() => extractBalancedBlock('if (x) { no close', 7)).toThrow(/Unbalanced braces/);
  });

  it('extractIfBlockBody finds conditional block bodies', () => {
    const source = `
      if (foo === 'bar') {
        doThing();
      }
      if (other) { ignored(); }
    `;
    expect(extractIfBlockBody(source, "foo === 'bar'")).toContain('doThing()');
    expect(extractIfBlockBody(source, 'missing')).toBe('');
  });

  it('extractUseCallbackBody finds callback bodies', () => {
    const source = `
      const handleRfConnectFailure = useCallback((err: unknown) => {
        isReconnectingRef.current = false;
        reconnectGenerationRef.current += 1;
      }, []);
    `;
    const body = extractUseCallbackBody(source, 'handleRfConnectFailure');
    expect(body).toContain('isReconnectingRef.current = false');
    expect(body).toContain('reconnectGenerationRef.current += 1');
  });

  it('extractUseCallbackBody returns empty string when marker is missing', () => {
    expect(extractUseCallbackBody('const x = 1;', 'missing')).toBe('');
  });
});
