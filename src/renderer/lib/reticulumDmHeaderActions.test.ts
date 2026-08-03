import { describe, expect, it } from 'vitest';

import {
  RETICULUM_DM_HEADER_ACTION_CLASS,
  RETICULUM_DM_HEADER_STATUS_CLASS,
} from './reticulumDmHeaderActions';

describe('reticulumDmHeaderActions', () => {
  it('exports outlined cyan chip action class with hover fill', () => {
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('border');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('border-cyan-500/35');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('rounded-lg');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toMatch(/text-cyan-/);
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('hover:bg-slate-800/70');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).not.toContain('hover:underline');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).not.toContain('rounded-full');
  });

  it('exports slate pill status class', () => {
    expect(RETICULUM_DM_HEADER_STATUS_CLASS).toContain('bg-slate-800/60');
    expect(RETICULUM_DM_HEADER_STATUS_CLASS).toContain('rounded-lg');
  });
});
