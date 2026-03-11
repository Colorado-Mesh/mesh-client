import { act, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from 'vitest-axe';

import LogPanel from './LogPanel';

describe('LogPanel accessibility', () => {
  it('has no axe violations with empty log', async () => {
    const { container } = render(<LogPanel />);
    await act(async () => {});
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
