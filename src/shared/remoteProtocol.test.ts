// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  clampHeadlessCoordinate,
  isClientInputMessage,
  normalizeModifiers,
} from './remoteProtocol';

describe('isClientInputMessage', () => {
  it('accepts every documented input shape', () => {
    expect(isClientInputMessage({ type: 'mousemove', x: 10, y: 20, buttons: 0 })).toBe(true);
    expect(isClientInputMessage({ type: 'mousedown', x: 1, y: 2, button: 'left' })).toBe(true);
    expect(isClientInputMessage({ type: 'mouseup', x: 1, y: 2, button: 'right' })).toBe(true);
    expect(isClientInputMessage({ type: 'wheel', x: 0, y: 0, deltaX: -10, deltaY: 24 })).toBe(true);
    expect(
      isClientInputMessage({ type: 'keydown', key: 'a', code: 'KeyA', modifiers: ['ctrl'] }),
    ).toBe(true);
    expect(isClientInputMessage({ type: 'keyup', key: 'a', code: 'KeyA', modifiers: [] })).toBe(
      true,
    );
    expect(isClientInputMessage({ type: 'char', char: '✓' })).toBe(true);
    expect(isClientInputMessage({ type: 'resize', width: 1280, height: 800 })).toBe(true);
  });

  it('rejects unknown types and malformed payloads', () => {
    expect(isClientInputMessage(null)).toBe(false);
    expect(isClientInputMessage('hello')).toBe(false);
    expect(isClientInputMessage({})).toBe(false);
    expect(isClientInputMessage({ type: 'nope' })).toBe(false);
    expect(isClientInputMessage({ type: 'mousedown', x: 1, y: 2, button: 'sideways' })).toBe(false);
    expect(isClientInputMessage({ type: 'keydown', key: 'a' })).toBe(false);
    expect(
      isClientInputMessage({ type: 'keydown', key: 'a', code: 'KeyA', modifiers: 'ctrl' }),
    ).toBe(false);
    expect(
      isClientInputMessage({ type: 'keydown', key: 'a', code: 'KeyA', modifiers: ['sudo'] }),
    ).toBe(false);
    expect(isClientInputMessage({ type: 'char', char: '' })).toBe(false);
  });
});

describe('normalizeModifiers', () => {
  it('dedupes, lowercases, and orders ctrl/alt/shift/meta', () => {
    expect(normalizeModifiers(['SHIFT', 'ctrl', 'shift'])).toEqual(['ctrl', 'shift']);
    expect(normalizeModifiers(['meta', 'alt'])).toEqual(['alt', 'meta']);
  });

  it('drops unknown modifiers and non-arrays', () => {
    expect(normalizeModifiers(['ctrl', 'SUPER'])).toEqual(['ctrl']);
    expect(normalizeModifiers(undefined)).toEqual([]);
    expect(normalizeModifiers('ctrl')).toEqual([]);
  });
});

describe('clampHeadlessCoordinate', () => {
  it('clamps to 0..max and rounds', () => {
    expect(clampHeadlessCoordinate(-5, 1280)).toBe(0);
    expect(clampHeadlessCoordinate(5000, 1280)).toBe(1280);
    expect(clampHeadlessCoordinate(12.6, 1280)).toBe(13);
    expect(clampHeadlessCoordinate(12.4, 1280)).toBe(12);
  });

  it('falls back to 0 on non-finite input', () => {
    expect(clampHeadlessCoordinate(Number.NaN, 1280)).toBe(0);
    expect(clampHeadlessCoordinate('bogus', 1280)).toBe(0);
  });
});
