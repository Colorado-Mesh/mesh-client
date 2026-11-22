import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import { isMeshcomLicenseAcknowledged } from '@/renderer/lib/meshcom/meshcomLicenseAck';

import { focusSelectedSectionTabSoon } from './firstRunFocus';
import { FirstRunProtocolPicker } from './FirstRunProtocolPicker';

vi.mock('./firstRunFocus', () => ({ focusSelectedSectionTabSoon: vi.fn() }));

function renderPicker() {
  const onContinue = vi.fn();
  const onSkip = vi.fn();
  const utils = render(<FirstRunProtocolPicker onContinue={onContinue} onSkip={onSkip} />);
  return { ...utils, onContinue, onSkip };
}

const box = (name: string) => screen.getByRole('checkbox', { name });

describe('FirstRunProtocolPicker', () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom has no layout, so offsetParent is always null; the dialogs' focus traps use it to
    // skip hidden controls. Report the parent, as a laid-out page does for visible elements.
    vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.parentElement;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is a labelled modal dialog that says where to change the choice later', () => {
    renderPicker();
    const dialog = screen.getByRole('dialog', { name: 'Choose your protocols' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription(/App > Protocols/);
  });

  it('describes what each protocol needs', () => {
    renderPicker();
    expect(box('Meshtastic')).toHaveAccessibleDescription(/MQTT alone/);
    expect(box('MeshCore')).toHaveAccessibleDescription(/Needs a MeshCore radio/);
    expect(box('Reticulum')).toHaveAccessibleDescription(/internet alone.*RNode/);
    expect(box('MeshCom')).toHaveAccessibleDescription(/amateur radio operators only/);
  });

  it('pre-checks the default protocols and continues with the current pick', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderPicker();
    expect(box('Meshtastic')).toBeChecked();
    expect(box('MeshCore')).toBeChecked();
    expect(box('Reticulum')).toBeChecked();
    expect(box('MeshCom')).not.toBeChecked();
    await user.click(box('MeshCore'));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(['meshtastic', 'reticulum']);
  });

  it('refuses to continue with nothing picked and says why', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderPicker();
    await user.click(box('Meshtastic'));
    await user.click(box('MeshCore'));
    await user.click(box('Reticulum'));
    const cont = screen.getByRole('button', { name: 'Continue' });
    expect(cont).toBeDisabled();
    expect(cont).toHaveAccessibleDescription('Choose at least one protocol.');
    await user.click(cont);
    expect(onContinue).not.toHaveBeenCalled();
  });

  it('skips on the Skip setup button and on Escape', async () => {
    const user = userEvent.setup();
    const { onSkip } = renderPicker();
    vi.mocked(focusSelectedSectionTabSoon).mockClear();
    await user.click(screen.getByRole('button', { name: 'Skip setup' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onSkip).toHaveBeenCalledTimes(2);
    expect(focusSelectedSectionTabSoon).toHaveBeenCalledTimes(2);
  });

  it('focuses the first control and keeps Tab inside the dialog', async () => {
    const user = userEvent.setup();
    renderPicker();
    expect(box('Meshtastic')).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();
    await user.tab();
    expect(box('Meshtastic')).toHaveFocus();
  });

  it('checks MeshCom only after the licence notice is accepted', async () => {
    const user = userEvent.setup();
    const { onContinue } = renderPicker();
    await user.click(box('MeshCom'));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(box('MeshCom')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'I understand' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box('MeshCom')).toBeChecked();
    expect(isMeshcomLicenseAcknowledged()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledWith(['meshtastic', 'meshcore', 'reticulum', 'meshcom']);
  });

  it('Escape in the licence notice closes only the notice, not the wizard', async () => {
    const user = userEvent.setup();
    const { onSkip } = renderPicker();
    await user.click(box('MeshCom'));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onSkip).not.toHaveBeenCalled();
    expect(box('MeshCom')).not.toBeChecked();
    expect(box('MeshCom')).toHaveFocus();
    expect(isMeshcomLicenseAcknowledged()).toBe(false);
  });

  it('Tab stays inside the licence notice while it is open', async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(box('MeshCom'));
    const notice = screen.getByRole('alertdialog');
    for (let i = 0; i < 4; i += 1) {
      await user.tab();
      expect(notice).toContainElement(document.activeElement as HTMLElement);
    }
  });

  it('asks for the licence only once it has been acknowledged', async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      'mesh-client:appSettings',
      JSON.stringify({ meshcomLicenseAcknowledged: true }),
    );
    renderPicker();
    await user.click(box('MeshCom'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(box('MeshCom')).toBeChecked();
  });

  it('has no axe violations', async () => {
    const { container } = renderPicker();
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
