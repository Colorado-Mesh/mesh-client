import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import NomadMicronPageView from './NomadMicronPageView';

describe('NomadMicronPageView', () => {
  const defaultProps = {
    defaultPagePath: '/page/index.mu',
    selectedHash: 'abc1234567890abcdef1234567890ab',
    onNavigate: vi.fn(),
    onDownloadFile: vi.fn(),
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
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
