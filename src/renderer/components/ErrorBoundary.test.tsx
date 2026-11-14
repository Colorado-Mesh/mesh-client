import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ErrorBoundary from './ErrorBoundary';

function Boom({ message = 'boom' }: { message?: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('renders children when there is no error', () => {
    render(
      <ErrorBoundary>
        <div>ok-child</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('ok-child')).toBeInTheDocument();
    expect(document.querySelector('[data-error-boundary="default"]')).toBeNull();
  });

  it('renders the default fallback with data-error-boundary and the error message', () => {
    render(
      <ErrorBoundary>
        <Boom message="panel crashed" />
      </ErrorBoundary>,
    );
    expect(document.querySelector('[data-error-boundary="default"]')).toBeTruthy();
    expect(screen.getByRole('alert')).toHaveTextContent('panel crashed');
  });

  it('remounts children when resetError is invoked via Try again', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('transient');
      return <div>recovered-child</div>;
    }
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    expect(document.querySelector('[data-error-boundary="default"]')).toBeTruthy();
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(screen.getByText('recovered-child')).toBeInTheDocument();
    expect(document.querySelector('[data-error-boundary="default"]')).toBeNull();
  });

  it('clears the error when resetKeys change', async () => {
    const user = userEvent.setup();
    function Parent() {
      const [key, setKey] = useState(1);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setKey(2);
            }}
          >
            bump
          </button>
          <ErrorBoundary resetKeys={[key]}>
            {key === 1 ? <Boom message="explode-1" /> : <div>after-reset-keys</div>}
          </ErrorBoundary>
        </div>
      );
    }
    render(<Parent />);
    expect(screen.getByRole('alert')).toHaveTextContent('explode-1');
    await user.click(screen.getByRole('button', { name: 'bump' }));
    expect(screen.getByText('after-reset-keys')).toBeInTheDocument();
  });

  it('calls onReset when recovering via Try again', async () => {
    const user = userEvent.setup();
    const onReset = vi.fn();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error('transient');
      return <div>ok</div>;
    }
    render(
      <ErrorBoundary onReset={onReset}>
        <Flaky />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: 'Try Again' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
