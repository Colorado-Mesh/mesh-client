import { describe, expect, it } from 'vitest';

import { flasherStepButtonClass, type FlasherStepButtonState } from './flasherStepButtonStyles';

describe('flasherStepButtonClass', () => {
  it.each(['disabled', 'ready', 'busy', 'done'] as FlasherStepButtonState[])(
    'returns classes for state %s',
    (state) => {
      expect(flasherStepButtonClass(state)).toContain('rounded');
    },
  );

  it('uses readable-green for ready, busy, and done', () => {
    expect(flasherStepButtonClass('ready')).toContain('bg-readable-green');
    expect(flasherStepButtonClass('busy')).toContain('bg-readable-green');
    expect(flasherStepButtonClass('done')).toContain('bg-readable-green');
  });

  it('uses outline style when disabled', () => {
    expect(flasherStepButtonClass('disabled')).toContain('border-gray-600');
    expect(flasherStepButtonClass('disabled')).not.toContain('bg-readable-green');
  });
});
