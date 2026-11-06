import { describe, expect, it } from 'vitest';

import { buttonClassName } from '@/renderer/components/ui/Button';

import {
  RETICULUM_DM_HEADER_ACTION_CLASS,
  RETICULUM_DM_HEADER_STATUS_CLASS,
} from './reticulumDmHeaderActions';

describe('reticulumDmHeaderActions', () => {
  it('exports secondary sm action class matching Button', () => {
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toBe(buttonClassName('secondary', 'sm'));
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('bg-sidebar-active-bg');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).toContain('border-secondary-dark');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).not.toContain('border-cyan-500/35');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).not.toContain('hover:underline');
    expect(RETICULUM_DM_HEADER_ACTION_CLASS).not.toContain('rounded-full');
  });

  it('exports slate pill status class', () => {
    expect(RETICULUM_DM_HEADER_STATUS_CLASS).toContain('bg-ink-800/60');
    expect(RETICULUM_DM_HEADER_STATUS_CLASS).toContain('rounded-lg');
  });
});
