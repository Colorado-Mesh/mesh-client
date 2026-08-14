import { describe, expect, it } from 'vitest';

import {
  QUEUE_BADGE_AMBER,
  QUEUE_BADGE_GREEN,
  QUEUE_BADGE_RED,
  queueBadgeColorClass,
  queueBadgeColorClassAbsolute,
  queueBadgeColorClassRatio,
} from './queueBadgeColors';

describe('queueBadgeColorClassAbsolute', () => {
  it('uses Meshtastic-style absolute thresholds', () => {
    expect(queueBadgeColorClassAbsolute(0)).toBe(QUEUE_BADGE_GREEN);
    expect(queueBadgeColorClassAbsolute(10)).toBe(QUEUE_BADGE_GREEN);
    expect(queueBadgeColorClassAbsolute(11)).toBe(QUEUE_BADGE_AMBER);
    expect(queueBadgeColorClassAbsolute(14)).toBe(QUEUE_BADGE_AMBER);
    expect(queueBadgeColorClassAbsolute(15)).toBe(QUEUE_BADGE_RED);
  });
});

describe('queueBadgeColorClassRatio', () => {
  it('uses Reticulum fill-ratio thresholds', () => {
    expect(queueBadgeColorClassRatio(0, 256)).toBe(QUEUE_BADGE_GREEN);
    expect(queueBadgeColorClassRatio(63, 256)).toBe(QUEUE_BADGE_GREEN); // <25%
    expect(queueBadgeColorClassRatio(64, 256)).toBe(QUEUE_BADGE_AMBER); // 25%
    expect(queueBadgeColorClassRatio(153, 256)).toBe(QUEUE_BADGE_AMBER); // <60%
    expect(queueBadgeColorClassRatio(154, 256)).toBe(QUEUE_BADGE_RED); // ≥60%
  });

  it('treats invalid max as green', () => {
    expect(queueBadgeColorClassRatio(10, 0)).toBe(QUEUE_BADGE_GREEN);
  });
});

describe('queueBadgeColorClass', () => {
  it('dispatches by mode', () => {
    expect(queueBadgeColorClass(15, 256, 'absolute')).toBe(QUEUE_BADGE_RED);
    expect(queueBadgeColorClass(15, 256, 'ratio')).toBe(QUEUE_BADGE_GREEN);
  });
});
