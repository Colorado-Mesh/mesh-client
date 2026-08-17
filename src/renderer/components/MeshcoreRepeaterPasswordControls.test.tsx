// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import { MeshcoreRepeaterPasswordControls } from './MeshcoreRepeaterPasswordControls';

vi.mock('@/renderer/lib/meshcoreRepeaterSavedSecrets', () => ({
  getMeshcoreRepeaterSavedSecretsSummary: vi.fn(() => ({ hasCredential: false })),
  forgetMeshcoreRepeaterSavedSecret: vi.fn().mockResolvedValue(undefined),
}));

import {
  forgetMeshcoreRepeaterSavedSecret,
  getMeshcoreRepeaterSavedSecretsSummary,
} from '@/renderer/lib/meshcoreRepeaterSavedSecrets';

describe('MeshcoreRepeaterPasswordControls', () => {
  beforeEach(() => {
    vi.mocked(getMeshcoreRepeaterSavedSecretsSummary).mockReturnValue({ hasCredential: false });
    vi.mocked(forgetMeshcoreRepeaterSavedSecret).mockClear();
  });

  it('prompts to save password when none stored', async () => {
    const user = userEvent.setup();
    const onPromptPassword = vi.fn().mockResolvedValue({ ok: true, saved: true });
    const onSecretsChanged = vi.fn();
    const onStatusMessage = vi.fn();

    render(
      <MeshcoreRepeaterPasswordControls
        nodeId={0x100}
        nodeName="Repeater A"
        secretsEpoch={0}
        onPromptPassword={onPromptPassword}
        onSecretsChanged={onSecretsChanged}
        onStatusMessage={onStatusMessage}
      />,
    );

    await user.click(screen.getByRole('button', { name: /save password/i }));
    expect(onPromptPassword).toHaveBeenCalledWith(0x100, 'Repeater A');
    expect(onSecretsChanged).toHaveBeenCalled();
    expect(onStatusMessage).toHaveBeenCalledWith(expect.stringMatching(/saved/i));
  });

  it('forgets saved password and notifies callbacks', async () => {
    vi.mocked(getMeshcoreRepeaterSavedSecretsSummary).mockReturnValue({ hasCredential: true });
    const user = userEvent.setup();
    const onSecretsChanged = vi.fn();
    const onStatusMessage = vi.fn();

    const { container } = render(
      <MeshcoreRepeaterPasswordControls
        nodeId={0x200}
        nodeName="Repeater B"
        secretsEpoch={1}
        onPromptPassword={vi.fn()}
        onSecretsChanged={onSecretsChanged}
        onStatusMessage={onStatusMessage}
      />,
    );

    await user.click(screen.getByRole('button', { name: /forget saved admin password/i }));
    expect(forgetMeshcoreRepeaterSavedSecret).toHaveBeenCalledWith(0x200);
    expect(onSecretsChanged).toHaveBeenCalled();
    expect(onStatusMessage).toHaveBeenCalledWith(expect.stringMatching(/removed/i));
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
