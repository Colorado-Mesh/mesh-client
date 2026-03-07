import { render } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { describe, it, expect, vi } from 'vitest';
import KeyboardShortcutsModal from './KeyboardShortcutsModal';

describe('KeyboardShortcutsModal accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <KeyboardShortcutsModal onClose={vi.fn()} />
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
