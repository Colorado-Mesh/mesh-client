import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '@/renderer/lib/a11yTestHelpers';

import { SettingsCollapsible, SettingsSection } from './SettingsSection';

describe('SettingsSection', () => {
  it('renders a muted title outside a filled card', () => {
    const { container } = render(
      <SettingsSection title="Window" description="Tray behavior">
        <span>Close to tray</span>
      </SettingsSection>,
    );
    const heading = screen.getByRole('heading', { name: 'Window' });
    expect(heading.className).toContain('text-muted');
    expect(screen.getByText('Tray behavior')).toBeInTheDocument();
    const card = container.querySelector('.bg-deep-black.rounded-xl');
    expect(card).toBeTruthy();
    expect(card).toHaveTextContent('Close to tray');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <SettingsSection title="Updates">
        <label>
          <input type="checkbox" /> Auto-download
        </label>
      </SettingsSection>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('SettingsCollapsible', () => {
  it('starts collapsed by default', () => {
    const { container } = render(
      <SettingsCollapsible title="Renderer memory" anchorId="app.support.rendererMemory">
        <p>Sample chart</p>
      </SettingsCollapsible>,
    );
    const details = container.querySelector('details');
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect(details!.open).toBe(false);
    expect(details).toHaveAttribute('data-setting-anchor', 'app.support.rendererMemory');
    const summary = screen.getByText('Renderer memory');
    expect(summary.closest('summary')?.className).toContain('text-muted');
    expect(summary.closest('summary')?.className).not.toContain('text-ink-200');
  });

  it('opens by default when defaultOpen is true', () => {
    const { container } = render(
      <SettingsCollapsible title="Open section" defaultOpen>
        <p>Visible</p>
      </SettingsCollapsible>,
    );
    const details = container.querySelector('details');
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    expect(details!.open).toBe(true);
  });

  it('uses danger chrome when variant is danger', () => {
    const { container } = render(
      <SettingsCollapsible title="Danger zone" variant="danger">
        <button type="button">Clear</button>
      </SettingsCollapsible>,
    );
    const details = container.querySelector('details');
    expect(details?.className).toContain('border-red-900');
    expect(screen.getByText('Danger zone').closest('summary')?.className).toContain('text-red-300');
  });

  it('notifies onToggle when opened', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <SettingsCollapsible title="AI" onToggle={onToggle}>
        <p>Body</p>
      </SettingsCollapsible>,
    );
    const details = container.querySelector('details');
    expect(details).toBeInstanceOf(HTMLDetailsElement);
    details!.open = true;
    fireEvent(details!, new Event('toggle', { bubbles: true }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('forwards a ref to the details element', () => {
    const ref = { current: null as HTMLDetailsElement | null };
    render(
      <SettingsCollapsible ref={ref} title="Ref section">
        <p>Body</p>
      </SettingsCollapsible>,
    );
    expect(ref.current).toBeInstanceOf(HTMLDetailsElement);
    ref.current!.open = true;
    expect(ref.current!.open).toBe(true);
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <SettingsCollapsible title="Protocols" description="Enable at least one">
        <label>
          <input type="checkbox" /> Meshtastic
        </label>
      </SettingsCollapsible>,
    );
    hydrateAxeThemeColors(container);
    expect(await axe(container)).toHaveNoViolations();
  });
});
