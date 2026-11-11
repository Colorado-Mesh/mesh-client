import { describe, expect, it } from 'vitest';

import { mecpCodeInComposeMode } from './mecpComposeRoles';

describe('mecpCodeInComposeMode', () => {
  it('returns true for all mode', () => {
    expect(mecpCodeInComposeMode('R14', 'all')).toBe(true);
    expect(mecpCodeInComposeMode('H02', 'all')).toBe(true);
    expect(mecpCodeInComposeMode('anything', 'all')).toBe(true);
  });

  it('returns true for response mode when code starts with response categories', () => {
    expect(mecpCodeInComposeMode('R14', 'response')).toBe(true);
    expect(mecpCodeInComposeMode('H05', 'response')).toBe(true);
    expect(mecpCodeInComposeMode('P10', 'response')).toBe(true);
    expect(mecpCodeInComposeMode('C01', 'response')).toBe(true);
    expect(mecpCodeInComposeMode('D12', 'response')).toBe(true);
  });

  it('returns true for response mode when code is in M14/M15/T10/B02 set', () => {
    expect(mecpCodeInComposeMode('M14', 'response')).toBe(true);
    expect(mecpCodeInComposeMode('M15', 'response')).toBe(true);
    expect(mecpCodeInComposeMode('T10', 'response')).toBe(true);
    expect(mecpCodeInComposeMode('B02', 'response')).toBe(true);
  });

  it('returns false for request mode when code starts with R or H', () => {
    expect(mecpCodeInComposeMode('R14', 'request')).toBe(false);
    expect(mecpCodeInComposeMode('H02', 'request')).toBe(false);
  });

  it('returns false for request mode when code starts with R or H or is B02', () => {
    expect(mecpCodeInComposeMode('A01', 'request')).toBe(true);
    expect(mecpCodeInComposeMode('T10', 'request')).toBe(true);
    expect(mecpCodeInComposeMode('B02', 'request')).toBe(false);
    expect(mecpCodeInComposeMode('R14', 'request')).toBe(false);
    expect(mecpCodeInComposeMode('H05', 'request')).toBe(false);
  });

  it('returns true when code does not start with R or H and not in response set', () => {
    expect(mecpCodeInComposeMode('A01', 'request')).toBe(true);
    expect(mecpCodeInComposeMode('D05', 'request')).toBe(true);
  });
});
