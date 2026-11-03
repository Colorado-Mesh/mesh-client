import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { CHAT_DOCS_URL } from '@/shared/docsSite';

import { DocsSiteLink } from './DocsSiteLink';

describe('DocsSiteLink', () => {
  it('renders an external docs-site link with the default label', () => {
    render(<DocsSiteLink href={CHAT_DOCS_URL} />);
    const link = screen.getByRole('link', { name: /docs/i });
    expect(link).toHaveAttribute('href', CHAT_DOCS_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noreferrer');
  });
});
