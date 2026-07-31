import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import { hydrateAxeThemeColors } from '../lib/a11yTestHelpers';
import NomadMicronPageView from './NomadMicronPageView';

const LXMF_HASH = '368f994c056de0d8882855eb0d627497';

describe('NomadMicronPageView', () => {
  const defaultProps = {
    defaultPagePath: '/page/index.mu',
    selectedHash: 'abc1234567890abcdef1234567890ab',
    onNavigate: vi.fn(),
    onDownloadFile: vi.fn(),
    onOpenDm: vi.fn(),
  };

  it('does not mount script tags from malicious micron markup', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(
      <NomadMicronPageView {...defaultProps} content="`<script>alert('xss')</script>Hello`" />,
    );

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Hello');
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('strips inline event handlers from injected HTML', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
    render(
      <NomadMicronPageView {...defaultProps} content="`<img src=x onerror=alert(1)>Safe text`" />,
    );

    expect(document.querySelectorAll('.nomad-micron-page [onerror]').length).toBe(0);
    expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Safe text');
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('has no serious accessibility violations', async () => {
    const { container } = render(
      <NomadMicronPageView {...defaultProps} content="`!Nomad page:`!\n`[Link`:/page/other.mu`]" />,
    );
    hydrateAxeThemeColors(container);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });

  it('opens DM for lxmf:// links instead of navigating', () => {
    const onOpenDm = vi.fn();
    const onNavigate = vi.fn();
    const markup = `\`[Contact\`lxmf://${LXMF_HASH}\`*]\``;
    render(
      <NomadMicronPageView
        {...defaultProps}
        onOpenDm={onOpenDm}
        onNavigate={onNavigate}
        content={markup}
      />,
    );
    const link = document.querySelector<HTMLElement>('[data-action="openNode"]');
    expect(link).not.toBeNull();
    const href = link?.getAttribute('href');
    const title = link?.getAttribute('title');
    const dataDest = link?.getAttribute('data-destination');
    expect(href ?? title ?? dataDest).toBeTruthy();
    fireEvent.click(link!);
    expect(onOpenDm).toHaveBeenCalledWith(LXMF_HASH);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('submits Micron form field values on link click', () => {
    const onNavigate = vi.fn();
    const markup = ['`Search:`', '`<20|q`>`', '`[Go`:/page/results.mu`q|mode=search|*]`'].join(
      '\n',
    );
    render(<NomadMicronPageView {...defaultProps} onNavigate={onNavigate} content={markup} />);
    const textInput = document.querySelector<HTMLInputElement>('input[name="q"]');
    expect(textInput).not.toBeNull();
    if (textInput) textInput.value = 'mesh';
    const link = document.querySelector<HTMLElement>('[data-action="openNode"]');
    expect(link).not.toBeNull();
    fireEvent.click(link!);
    expect(onNavigate).toHaveBeenCalledWith(
      defaultProps.selectedHash,
      '/page/results.mu',
      expect.objectContaining({
        field_q: 'mesh',
        var_mode: 'search',
      }),
    );
  });

  it('preserves Micron form input when only link callbacks change', () => {
    const markup = ['`Search:`', '`<20|q`>`', '`[Go`:/page/results.mu`q|*]`'].join('\n');
    const { rerender } = render(<NomadMicronPageView {...defaultProps} content={markup} />);
    const textInput = document.querySelector<HTMLInputElement>('input[name="q"]');
    expect(textInput).not.toBeNull();
    if (textInput) textInput.value = 'mesh';

    rerender(
      <NomadMicronPageView
        {...defaultProps}
        content={markup}
        onNavigate={vi.fn()}
        onDownloadFile={vi.fn()}
        onOpenDm={vi.fn()}
      />,
    );
    expect(document.querySelector<HTMLInputElement>('input[name="q"]')?.value).toBe('mesh');
  });

  it('replaces rendered page content when content changes', () => {
    const { rerender } = render(
      <NomadMicronPageView {...defaultProps} content="PAGE_ALPHA_UNIQUE" />,
    );
    expect(document.querySelector('.nomad-micron-page')?.textContent).toContain(
      'PAGE_ALPHA_UNIQUE',
    );
    rerender(<NomadMicronPageView {...defaultProps} content="PAGE_BETA_UNIQUE" />);
    const text = document.querySelector('.nomad-micron-page')?.textContent ?? '';
    expect(text).toContain('PAGE_BETA_UNIQUE');
    expect(text).not.toContain('PAGE_ALPHA_UNIQUE');
  });

  it('defaults to fit-width class and drops it when fitWidth is false', () => {
    const { rerender } = render(<NomadMicronPageView {...defaultProps} content="`!Wrap me:`!" />);
    expect(document.querySelector('.nomad-micron-page')).toHaveClass(
      'nomad-micron-page--fit-width',
    );

    rerender(<NomadMicronPageView {...defaultProps} fitWidth={false} content="`!Wrap me:`!" />);
    expect(document.querySelector('.nomad-micron-page')).not.toHaveClass(
      'nomad-micron-page--fit-width',
    );
  });

  it('keeps box padding spaces in the mounted DOM for fit-width and open-width', () => {
    const markup = [
      '    │  This is the NomadNet page of the RMAP Project, a web interface      │',
      '    │  `F8f0•`f Visualize LoRa RNode Connection Info,                        │ │',
    ].join('\n');

    const { rerender } = render(<NomadMicronPageView {...defaultProps} content={markup} />);
    const fitRoot = document.querySelector('.nomad-micron-page');
    expect(fitRoot).toHaveClass('nomad-micron-page--fit-width');
    expect(fitRoot?.textContent).toMatch(/web interface {2,}│/);
    expect(fitRoot?.textContent).toMatch(/Connection Info, {2,}│ │/);

    rerender(<NomadMicronPageView {...defaultProps} fitWidth={false} content={markup} />);
    const openRoot = document.querySelector('.nomad-micron-page');
    expect(openRoot).not.toHaveClass('nomad-micron-page--fit-width');
    expect(openRoot?.textContent).toMatch(/web interface {2,}│/);
    expect(openRoot?.textContent).toMatch(/Connection Info, {2,}│ │/);
  });

  it('fetches and mounts Micron partial content via onFetchPartial', async () => {
    const onFetchPartial = vi.fn().mockResolvedValue({
      ok: true,
      content: '`!Loaded partial:`!',
    });
    render(
      <NomadMicronPageView
        {...defaultProps}
        onFetchPartial={onFetchPartial}
        content="`{:/page/partial.mu}"
      />,
    );

    await vi.waitFor(() => {
      expect(document.querySelector('.nomad-micron-page')?.textContent).toContain('Loaded partial');
    });
    expect(onFetchPartial).toHaveBeenCalledWith(
      defaultProps.selectedHash,
      '/page/partial.mu',
      undefined,
    );
  });

  it('navigates links that appear inside loaded partial markup', async () => {
    const onNavigate = vi.fn();
    const onFetchPartial = vi.fn().mockResolvedValue({
      ok: true,
      content: '`[Inner`:/page/inner.mu`]',
    });
    render(
      <NomadMicronPageView
        {...defaultProps}
        onNavigate={onNavigate}
        onFetchPartial={onFetchPartial}
        content="`{:/page/partial.mu}"
      />,
    );

    await vi.waitFor(() => {
      expect(document.querySelector('[data-action="openNode"]')).not.toBeNull();
    });
    fireEvent.click(document.querySelector('[data-action="openNode"]')!);
    expect(onNavigate).toHaveBeenCalledWith(defaultProps.selectedHash, '/page/inner.mu', undefined);
  });
});
