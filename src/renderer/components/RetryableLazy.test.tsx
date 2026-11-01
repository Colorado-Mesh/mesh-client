import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { RetryableLazy } from './RetryableLazy';

describe('RetryableLazy', () => {
  it('renders the lazy component after load', async () => {
    function Ready() {
      return <div>ready-overlay</div>;
    }
    render(
      <RetryableLazy
        loader={() => Promise.resolve({ default: Ready })}
        fallback={<div>loading</div>}
      >
        {(C) => <C />}
      </RetryableLazy>,
    );
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('ready-overlay')).toBeInTheDocument();
  });

  it('retries with a fresh lazy() after a rejected import', async () => {
    const user = userEvent.setup();
    let calls = 0;
    function Ready() {
      return <div>recovered</div>;
    }
    render(
      <RetryableLazy
        loader={() => {
          calls += 1;
          if (calls === 1) return Promise.reject(new Error('chunk failed'));
          return Promise.resolve({ default: Ready });
        }}
        fallback={<div>loading</div>}
      >
        {(C) => <C />}
      </RetryableLazy>,
    );
    expect(await screen.findByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    await waitFor(() => {
      expect(screen.getByText('recovered')).toBeInTheDocument();
    });
    expect(calls).toBe(2);
  });
});
