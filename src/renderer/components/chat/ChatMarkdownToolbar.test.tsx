import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { ChatMarkdownToolbar } from '@/renderer/components/chat/ChatMarkdownToolbar';
import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';
import {
  registerChatMarkdownToolbarTarget,
  resetChatMarkdownToolbarTargetForTests,
} from '@/renderer/lib/chatMarkdownToolbarTarget';
import { applyFontScale, resetFontScale } from '@/renderer/lib/fontScale';

describe('ChatMarkdownToolbar', () => {
  beforeEach(() => {
    resetChatMarkdownToolbarTargetForTests();
  });

  afterEach(() => {
    cleanup();
    resetChatMarkdownToolbarTargetForTests();
    resetFontScale();
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

  it('uses compact rem h-6 hit targets so Appearance text size scales them', () => {
    render(<ChatMarkdownToolbar onWrap={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Bold' }).className).toContain('h-6');
  });

  it('scales Lucide icon size with Appearance text size', () => {
    applyFontScale(1.5);
    render(<ChatMarkdownToolbar onWrap={vi.fn()} />);
    const svg = screen.getByRole('button', { name: 'Bold' }).querySelector('svg');
    expect(svg).toHaveAttribute('width', '21');
    expect(svg).toHaveAttribute('height', '21');
  });

  it('has no axe violations', async () => {
    const { container } = render(<ChatMarkdownToolbar />);
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
