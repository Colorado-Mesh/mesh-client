import { describe, expect, it } from 'vitest';

import {
  RETICULUM_DM_HEADER_ACTION_CLASS,
  RETICULUM_DM_HEADER_STATUS_CLASS,
} from './reticulumDmHeaderActions';

describe('reticulumDmHeaderActions', () => {
  it('exports cyan text-link action class without boxed/pill chrome', () => {
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('text-cyan-400');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('hover:underline');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).not.toMatch(/\bborder\b/);
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).not.toContain('rounded-full');
  });

  it('exports slate pill status class', () => {
    expect(RETICULUM_DM_HEADER_STATUS_CLASS).toContain('bg-slate-800/60');
    expect(RETICULUM_DM_HEADER_STATUS_CLASS).toContain('rounded-lg');
  });
});
