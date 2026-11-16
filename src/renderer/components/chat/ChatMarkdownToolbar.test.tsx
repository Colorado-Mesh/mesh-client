import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ChatMarkdownToolbar } from '@/renderer/components/chat/ChatMarkdownToolbar';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  registerChatMarkdownToolbarTarget,
  resetChatMarkdownToolbarTargetForTests,
} from '@/renderer/lib/chatMarkdownToolbarTarget';

describe('ChatMarkdownToolbar', () => {
  beforeEach(() => {
    resetChatMarkdownToolbarTargetForTests();
  });

  afterEach(() => {
    cleanup();
    resetChatMarkdownToolbarTargetForTests();
  });

  it('stays disabled until a composer registers, then wraps via icons', () => {
    const { rerender } = render(<ChatMarkdownToolbar />);
    const bold = screen.getByRole('button', { name: 'Bold' });
    expect(bold).toBeDisabled();
    const wrap = vi.fn();
    const unregister = registerChatMarkdownToolbarTarget({
      isActive: () => true,
      wrap,
    });
    rerender(<ChatMarkdownToolbar />);
    expect(screen.getByRole('button', { name: 'Bold' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    expect(wrap).toHaveBeenCalledWith('**', '**');
    unregister();
    rerender(<ChatMarkdownToolbar />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
  });

  it('calls onWrap and ignores the registry when provided', () => {
    const onWrap = vi.fn();
    const registryWrap = vi.fn();
    registerChatMarkdownToolbarTarget({
      isActive: () => true,
      wrap: registryWrap,
    });
    render(<ChatMarkdownToolbar onWrap={onWrap} />);
    fireEvent.click(screen.getByRole('button', { name: 'Italic' }));
    expect(onWrap).toHaveBeenCalledWith('*', '*');
    expect(registryWrap).not.toHaveBeenCalled();
  });

  it('disables buttons when onWrap is set and disabled', () => {
    render(<ChatMarkdownToolbar onWrap={vi.fn()} disabled />);
    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
  });

  it('has no axe violations', async () => {
    const { container } = render(<ChatMarkdownToolbar />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
