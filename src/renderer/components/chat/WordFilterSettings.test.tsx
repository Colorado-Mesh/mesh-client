// @vitest-environment jsdom
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { useWordFilterStore } from '@/renderer/stores/wordFilterStore';

import { WordFilterSettings } from './WordFilterSettings';

describe('WordFilterSettings', () => {
  beforeEach(() => {
    useWordFilterStore.setState({ enabled: false, words: ['alpha', 'beta'] });
  });

  it('resets the draft when store words change while mounted', async () => {
    const user = userEvent.setup();
    render(<WordFilterSettings />);
    const input = screen.getByRole('textbox', { name: /word filter list/i });
    expect(input).toHaveValue('alpha, beta');
    await user.clear(input);
    await user.type(input, 'draft only');
    expect(input).toHaveValue('draft only');
    act(() => {
      useWordFilterStore.getState().setWordsText('gamma, delta');
    });
    await waitFor(() => {
      expect(input).toHaveValue('gamma, delta');
    });
  });
});
