import { describe, expect, it } from 'vitest';

import { flasherStepButtonClass, type FlasherStepButtonState } from './flasherStepButtonStyles';

describe('flasherStepButtonClass', () => {
  it.each(['disabled', 'ready', 'busy', 'done'] as FlasherStepButtonState[])(
    'returns classes for state %s',
    (state) => {
      expect(flasherStepButtonClass(state)).toContain('rounded');
    },
  );

  it('uses the accent green for ready, busy, and done', () => {
    expect(flasherStepButtonClass('ready')).toContain('bg-brand-green');
    expect(flasherStepButtonClass('busy')).toContain('bg-brand-green');
    expect(flasherStepButtonClass('done')).toContain('bg-brand-green');
  });

  it('uses outline style when disabled', () => {
    expect(flasherStepButtonClass('disabled')).toContain('border-ink-600');
    expect(flasherStepButtonClass('disabled')).not.toContain('bg-brand-green');
  });
});
