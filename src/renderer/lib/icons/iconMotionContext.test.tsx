import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { IconMotionProvider, useIconTrigger, useReduceMotion } from './iconMotionContext';

function Probe() {
  const reduceMotion = useReduceMotion();
  const trigger = useIconTrigger();
  return (
    <div>
      <span data-testid="reduce">{String(reduceMotion)}</span>
      <span data-testid="trigger">{trigger}</span>
    </div>
  );
}

describe('iconMotionContext', () => {
  it('reads reduce motion from storage via provider', () => {
    localStorage.setItem('mesh-client:appSettings', JSON.stringify({ reduceMotion: true }));
    render(
      <IconMotionProvider>
        <Probe />
      </IconMotionProvider>,
    );
    expect(screen.getByTestId('reduce')).toHaveTextContent('true');
    expect(screen.getByTestId('trigger')).toHaveTextContent('manual');
  });

  it('uses hover trigger when reduce motion is off', () => {
    localStorage.setItem('mesh-client:appSettings', JSON.stringify({ reduceMotion: false }));
    render(
      <IconMotionProvider>
        <Probe />
      </IconMotionProvider>,
    );
    expect(screen.getByTestId('trigger')).toHaveTextContent('hover');
  });
});
