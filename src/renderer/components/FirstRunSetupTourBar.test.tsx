import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import type { MeshProtocol } from '@/shared/meshProtocol';

import { focusSelectedSectionTabSoon } from './firstRunFocus';
import { FirstRunSetupTourBar } from './FirstRunSetupTourBar';

vi.mock('./firstRunFocus', () => ({ focusSelectedSectionTabSoon: vi.fn() }));

const TOUR: MeshProtocol[] = ['meshtastic', 'meshcore', 'reticulum', 'meshcom'];

function renderBar(step: number, protocols: MeshProtocol[] = TOUR) {
  const onNext = vi.fn();
  const onSkip = vi.fn();
  const utils = render(
    <FirstRunSetupTourBar protocols={protocols} step={step} onNext={onNext} onSkip={onSkip} />,
  );
  return { ...utils, onNext, onSkip };
}

describe('FirstRunSetupTourBar', () => {
  it.each([
    [0, 'Set up Meshtastic (1 of 4)', /MQTT only/],
    [1, 'Set up MeshCore (2 of 4)', /MeshCore radio/],
    [2, 'Set up Reticulum (3 of 4)', /setup guide/],
    [3, 'Set up MeshCom (4 of 4)', /MeshCom radio/],
  ])('step %i names the protocol, progress and what to do', (step, heading, hint) => {
    renderBar(step);
    expect(screen.getByRole('region', { name: 'Protocol setup' })).toBeInTheDocument();
    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getByText(hint)).toBeInTheDocument();
  });

  it('takes keyboard focus when it appears with nothing else focused', () => {
    renderBar(0);
    expect(screen.getByRole('region', { name: 'Protocol setup' })).toHaveFocus();
  });

  it('does not steal focus that already sits on a control', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    renderBar(0);
    expect(outside).toHaveFocus();
    outside.remove();
  });

  it('offers Next and Skip setup before the last step', async () => {
    vi.mocked(focusSelectedSectionTabSoon).mockClear();
    const user = userEvent.setup();
    const { onNext, onSkip } = renderBar(0);
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(focusSelectedSectionTabSoon).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(focusSelectedSectionTabSoon).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument();
  });

  it('ends with Done and where to change protocols later', async () => {
    vi.mocked(focusSelectedSectionTabSoon).mockClear();
    const user = userEvent.setup();
    const { onNext } = renderBar(1, ['meshtastic', 'reticulum']);
    expect(screen.getByText(/App > Protocols/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Skip setup' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(focusSelectedSectionTabSoon).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a step past the end', () => {
    const { container } = renderBar(5);
    expect(container).toBeEmptyDOMElement();
  });

  it('has no axe violations', async () => {
    const { container } = renderBar(0);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
