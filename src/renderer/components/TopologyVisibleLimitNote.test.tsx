import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { TopologyVisibleLimitNote } from './TopologyVisibleLimitNote';

describe('TopologyVisibleLimitNote', () => {
  it('renders the provided label as visible text and aria-label', () => {
    render(
      <TopologyVisibleLimitNote label="Graph shows at most 400 nodes (48 when distant peers are hidden)." />,
    );
    const note = screen.getByLabelText(
      'Graph shows at most 400 nodes (48 when distant peers are hidden).',
    );
    expect(note).toHaveTextContent('400');
    expect(note).toHaveTextContent('48');
  });
});
